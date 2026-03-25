/**
 * Fix common typos so embeddings match the right chunks (e.g. architecture doc).
 */
export function normalizeQueryForRag(raw) {
  return raw
    .trim()
    .replace(/\babb+out\b/gi, "about")
    .replace(/\barchetecture\b/gi, "architecture")
    .replace(/\barchiteture\b/gi, "architecture");
}

/**
 * Push the most relevant knowledge file to the front when the query clearly
 * mentions topics covered mainly in one doc (reduces bad top-1 hits from tiny generic FAQ chunks).
 *
 * @param {string} message
 * @param {Array<{ text?: string, source?: string, score?: number }>} hits
 */
export function rerankHitsByQuery(message, hits) {
  if (!hits?.length) return hits;

  const m = normalizeQueryForRag(message).toLowerCase();
  const prefer = [];

  if (
    /\b(project\s+architecture|project\s+stack|tell\s+me\s+(abb?out|about)|abb?out\s+(the\s+)?project|what\s+is\s+(the\s+)?project|this\s+project|architecture|stack|docker|qdrant|vllm|\brag\b|redis|compose|self[\s-]?host|node\.js|postgresql|postgres|chatbot service|vector|knowl[ae]dge\s+base)\b/i.test(
      m,
    ) ||
    /\b(?:\/health|health\s+endpoint|health\s+check|health\s+response|what\s+health|ollama|openai[\s-]?compatible|llm\s+model|which\s+model|what\s+model|configured\s+model|v1\/models)\b/i.test(
      m,
    ) ||
    (/\bproject\b/.test(m) && !/\bflipkart\b/i.test(m))
  ) {
    prefer.push("ai_support_chatbot_architecture.md");
  }

  if (
    /\b(e-?commerce|shopnest|shop\s+nest|online\s+store|online\s+shopping|customer\s+support|shopping\s+cart|\bcart\b|checkout|basket|order\s+(status|tracking|id|help)|track(ing)?\s+(order|package|shipment)|return|refund|replace(ment)?|exchange|delivery|shipping|courier|cod\b|cash\s+on\s+delivery|cancel\s+order|my\s+orders|pickup|invoice|gst|grievance|wrong\s+item|damaged)\b/i.test(
      m,
    )
  ) {
    prefer.push("ecommerce_support.md");
  }

  if (/\bflipkart\b|flip\s*kart|fkart|supercoin\b/i.test(m)) {
    prefer.push("flipkart_app.md");
  }

  if (prefer.length === 0) return hits;

  const matchSource = (src, name) => {
    const s = String(src || "");
    return s === name || s.endsWith(`/${name}`) || s.includes(name);
  };

  const boosted = [];
  const rest = [];
  for (const h of hits) {
    if (prefer.some((name) => matchSource(h.source, name))) boosted.push(h);
    else rest.push(h);
  }

  return [...boosted, ...rest];
}
