import { franc } from "franc-min";
import { searchSimilar } from "../services/vectorService.js";
import { getCachedReplySafe, setCachedReplySafe } from "../services/cacheService.js";
import { runChat } from "../services/llmService.js";
import { config } from "../config/env.js";
import {
  buildGreetingReply,
  inferGreetingLanguage,
  isGreetingOnly,
} from "../utils/chatGreeting.js";
import {
  buildSmallTalkReply,
  inferSmallTalkLanguage,
  isSmallTalkOnly,
} from "../utils/chatSmallTalk.js";
import { buildCleanKnowledgeExcerpt } from "../utils/knowledgeExcerpt.js";
import { looksLikeToolOrFunctionJson } from "../utils/llmReplySanitize.js";
import { rerankHitsByQuery } from "../utils/ragRerank.js";

function detectLanguageLabel(message) {
  const code = franc(message.slice(0, 500) || "und");
  if (code === "hin") return "Hindi";
  if (code === "eng") return "English";
  if (code === "urd") return "Urdu";
  return "mixed_or_other";
}

function classifyIntent(message) {
  const m = message.toLowerCase();
  if (/\b(price|pricing|buy|purchase|subscribe|plan|billing)\b/i.test(m)) return "sales_or_billing";
  if (/\b(bug|error|broken|not working)\b/i.test(m)) return "technical_support";
  return "support";
}

function genericMockOfferHelp() {
  const n = config.chatbotName;
  const a = config.applicationName;
  return `I'm ${n}. Tell me what you need about ${a} — for example orders, login, returns, or payments — and I'll help from our guides.`;
}

function noRetrievalReply() {
  const a = config.applicationName;
  return `I couldn't find that in our ${a} help content. Try asking about your cart, orders, delivery, returns, or payments — or contact support.`;
}

async function safeSearchSimilar(message) {
  try {
    const hits = await searchSimilar(message);
    return rerankHitsByQuery(message, hits);
  } catch (e) {
    console.error("[chat] vector search failed:", e?.stack || e?.message || e);
    return [];
  }
}

function buildSystemPrompt({ ragContext, languageHint, intent }) {
  const name = config.chatbotName;
  const app = config.applicationName;
  return [
    `You are ${name}, the support assistant for ${app}.`,
    "",
    "GROUNDING (mandatory):",
    "- You may ONLY use information that appears in the **Knowledge snippets** below.",
    "- **Keep exact facts:** Repeat names, attributions (e.g. who created a feature), numbers, and policy titles **exactly as written** in the snippets. Do not substitute generic wording (e.g. do not replace a named creator or product phrase with a vague description). You may fix grammar with minimal connecting words only.",
    "- Do not copy raw markdown headings, curl, or JSON unless the user asks for an example.",
    "- Do NOT invent facts: no made-up CPU/memory/network percentages, no generic “industry standard” claims, no “we cannot disclose” excuses, no filler about “cutting-edge AI” unless those exact ideas appear in the snippets.",
    "- Do NOT treat older or alternative setups in the snippets (e.g. example vLLM ports) as the live system unless the snippets clearly label them as **this** deployment. Prefer the section titled **Authoritative runtime reference** when it appears.",
    "- If the snippets do not contain enough to answer, say honestly that it is not in the documentation and suggest contacting official support. Do not guess.",
    "- Do not leak secrets, credentials, or stack traces; snippets are the only trusted source for product facts.",
    "",
    "Tone:",
    "- **Reply in the same language as the user** (English, Hindi, or Hinglish).",
    "- Natural prose only — no JSON tool calls, no {\"function\":...} blocks.",
    `- Question category: ${intent}. Language hint: ${languageHint}.`,
    "",
    "Knowledge snippets:",
    ragContext || "(none)",
  ].join("\n");
}

function jsonGreeting(message) {
  const glang = inferGreetingLanguage(message);
  const reply = buildGreetingReply(glang, config.chatbotName, config.applicationName, message);
  return {
    reply,
    cached: false,
    sources: [],
    language: glang === "hindi" ? "Hindi" : glang === "hinglish" ? "Hinglish" : "English",
    intent: "greeting",
    finishReason: "greeting",
  };
}

function jsonSmallTalk(message) {
  const slang = inferSmallTalkLanguage(message);
  const reply = buildSmallTalkReply(slang, config.chatbotName, config.applicationName);
  return {
    reply,
    cached: false,
    sources: [],
    language: slang === "hindi" ? "Hindi" : slang === "hinglish" ? "Hinglish" : "English",
    intent: "smalltalk",
    finishReason: "smalltalk",
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function postChat(req, res) {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    /** Instant replies — never call the LLM (avoids errors when Ollama is not running). */
    if (isGreetingOnly(message)) {
      return res.json(jsonGreeting(message));
    }

    const cached = await getCachedReplySafe(message);
    if (cached) {
      return res.json({
        reply: cached,
        cached: true,
        sources: [],
        language: detectLanguageLabel(message),
        intent: classifyIntent(message),
      });
    }

    if (isSmallTalkOnly(message)) {
      const body = jsonSmallTalk(message);
      if (body.reply.length < 4000) await setCachedReplySafe(message, body.reply);
      return res.json(body);
    }

    /** Knowledge-only mode (no LLM server). */
    if (config.llm.mock) {
      const hits = await safeSearchSimilar(message);
      const sources = [...new Set(hits.map((h) => h.source))];
      const excerpt = buildCleanKnowledgeExcerpt(hits);
      const reply = excerpt ?? genericMockOfferHelp();
      if (reply.length < 4000) await setCachedReplySafe(message, reply);
      return res.json({
        reply,
        cached: false,
        sources,
        language: detectLanguageLabel(message),
        intent: classifyIntent(message),
        finishReason: excerpt ? "mock_knowledge" : "mock_generic",
      });
    }

    /** Real LLM: RAG + synthesis (strictly grounded in retrieved snippets). */
    const hits = await safeSearchSimilar(message);
    const sources = [...new Set(hits.map((h) => h.source))];

    if (hits.length === 0) {
      /** Do not cache — empty Qdrant is often fixed after ingest; caching would block retries. */
      const reply = noRetrievalReply();
      return res.json({
        reply,
        cached: false,
        sources: [],
        language: detectLanguageLabel(message),
        intent: classifyIntent(message),
        finishReason: "no_retrieval",
      });
    }

    const ragContext = hits
      .filter((h) => h.text)
      .map((h, i) => `[${i + 1}] (${h.source}, score=${h.score.toFixed(3)})\n${h.text}`)
      .join("\n\n");

    const languageHint = detectLanguageLabel(message);
    const intent = classifyIntent(message);
    const systemPrompt = buildSystemPrompt({ ragContext, languageHint, intent });

    let reply;
    let finishReason;

    try {
      const out = await runChat({
        systemPrompt,
        userMessage: message,
        history: [],
      });
      reply = out.reply;
      finishReason = out.finishReason;

      if (looksLikeToolOrFunctionJson(reply)) {
        console.warn("[chat] LLM returned tool-like JSON; substituting knowledge excerpt");
        const excerpt = buildCleanKnowledgeExcerpt(hits);
        reply = excerpt
          ? `Here's what I can tell you from our product documentation:\n\n${excerpt}`
          : genericMockOfferHelp();
        finishReason = "llm_tool_json_fallback";
      }
    } catch (llmErr) {
      console.error("[chat] LLM failed:", llmErr?.stack || llmErr?.message || llmErr);
      const excerpt = buildCleanKnowledgeExcerpt(hits);
      reply = excerpt ?? genericMockOfferHelp();
      finishReason = "llm_unavailable_fallback";
    }

    if (reply && reply.length < 4000) await setCachedReplySafe(message, reply);

    return res.json({
      reply,
      cached: false,
      sources,
      language: languageHint,
      intent,
      finishReason,
    });
  } catch (err) {
    console.error("[chat] unhandled:", err?.stack || err?.message || err);
    const dev = config.nodeEnv !== "production";
    return res.status(500).json({
      error: "internal_error",
      ...(dev && err?.message ? { detail: String(err.message) } : {}),
    });
  }
}
