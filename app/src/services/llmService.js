import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "../config/env.js";

function mockReplyText() {
  const n = config.chatbotName;
  const a = config.applicationName;
  return `I'm ${n}. Tell me what you need about ${a} — orders, login, returns, or payments — and I'll help from our guides.`;
}

function createModel() {
  return new ChatOpenAI({
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    configuration: { baseURL: config.llm.baseUrl },
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
    timeout: config.llm.timeoutMs,
    maxRetries: 0,
  });
}

async function runChatLoop({ systemPrompt, userMessage, history = [] }) {
  const model = createModel();
  const messages = [
    new SystemMessage(systemPrompt),
    ...history.map((m) =>
      m.role === "assistant" ? new AIMessage(m.content ?? "") : new HumanMessage(m.content ?? ""),
    ),
    new HumanMessage(userMessage),
  ];

  const res = await model.invoke(messages);
  const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return { reply: text.trim() || "Please contact support.", finishReason: "stop" };
}

/**
 * @param {object} p
 * @param {string} p.systemPrompt
 * @param {string} p.userMessage
 * @param {Array<{role: string, content?: string}>} [p.history]
 */
export async function runChat({ systemPrompt, userMessage, history = [] }) {
  if (config.llm.mock) {
    return {
      reply: mockReplyText(),
      finishReason: "mock",
    };
  }

  const ms = Math.max(5000, config.llm.timeoutMs);
  return Promise.race([
    runChatLoop({ systemPrompt, userMessage, history }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`LLM unreachable or timed out after ${ms}ms (check LLM_MOCK=true or Ollama at ${config.llm.baseUrl})`));
      }, ms);
    }),
  ]);
}
