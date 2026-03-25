import dotenv from "dotenv";

dotenv.config();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",

  /** Shown in greetings and system prompts (human-style intros). */
  chatbotName: (process.env.CHATBOT_NAME || "Asha").trim(),
  applicationName: (process.env.APPLICATION_NAME || "AI Support Chatbot").trim(),

  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  qdrantUrl: process.env.QDRANT_URL || "http://127.0.0.1:6333",
  qdrantCollection: process.env.QDRANT_COLLECTION || "application_docs",

  /** When false (default), Postgres health checks are skipped. */
  usePostgres: String(process.env.USE_POSTGRES || "").toLowerCase() === "true",

  pg: {
    host: process.env.PGHOST || "127.0.0.1",
    port: num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE || "support",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "password",
  },

  llm: {
    mock: String(process.env.LLM_MOCK || "").toLowerCase() === "true",
    baseUrl: (process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/$/, ""),
    /** OpenAI / Groq / Together: set for hosted APIs. Ollama local usually needs no key. */
    apiKey: (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim() || "not-used",
    model: process.env.LLM_MODEL || "qwen3:0.6b",
    /** Lower = more faithful to retrieved context (less hallucination). */
    temperature: num(process.env.LLM_TEMPERATURE, 0.1),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 1024),
    /** Max wait for one LLM round-trip (avoids hanging when Ollama is down). */
    /** Ollama on CPU can be slow; allow a higher default than cloud APIs. */
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 120_000),
  },

  cacheTtlSeconds: num(process.env.CACHE_TTL_SECONDS, 86400),
  ragTopK: num(process.env.RAG_TOP_K, 8),
  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",

  /**
   * When true (default): reply is built only from retrieved knowledge text — no LLM paraphrase.
   * Set RAG_STRICT_EXCERPT=false to allow the LLM to synthesize from snippets (may add generic details).
   */
  ragStrictExcerpt: !["false", "0", "no"].includes(
    String(process.env.RAG_STRICT_EXCERPT ?? "true").toLowerCase(),
  ),
};
