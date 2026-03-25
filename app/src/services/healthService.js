import { redis } from "../config/redis.js";
import { query } from "../config/db.js";
import { qdrant } from "../config/qdrant.js";
import { config } from "../config/env.js";

function msSince(t0) {
  return Math.round(performance.now() - t0);
}

async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function checkRedis() {
  const t0 = performance.now();
  try {
    const pong = await withTimeout(redis.ping(), 3000, "redis");
    if (pong !== "PONG") {
      return { ok: false, error: `unexpected ping reply: ${pong}`, latencyMs: msSince(t0) };
    }
    return { ok: true, latencyMs: msSince(t0) };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[health] redis failed:", msg);
    return { ok: false, error: msg, latencyMs: msSince(t0) };
  }
}

/**
 * @returns {Promise<{ ok: boolean, latencyMs?: number, points?: number, error?: string }>}
 */
export async function checkQdrant() {
  const t0 = performance.now();
  try {
    const info = await withTimeout(qdrant.getCollection(config.qdrantCollection), 5000, "qdrant");
    const points = Number(info.points_count ?? 0);
    return {
      ok: true,
      latencyMs: msSince(t0),
      collection: config.qdrantCollection,
      points,
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[health] qdrant failed:", msg);
    return { ok: false, error: msg, collection: config.qdrantCollection, latencyMs: msSince(t0) };
  }
}

/**
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function checkPostgres() {
  if (!config.usePostgres) {
    return {
      ok: true,
      skipped: true,
      reason: "Set USE_POSTGRES=true to enable this check.",
    };
  }
  const t0 = performance.now();
  try {
    await withTimeout(query("SELECT 1 as ok"), 5000, "postgres");
    return { ok: true, latencyMs: msSince(t0), database: config.pg.database };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[health] postgres failed:", msg);
    return { ok: false, error: msg, latencyMs: msSince(t0) };
  }
}

function formatNodeFetchError(e) {
  if (e?.name === "AbortError") return { text: "request timed out (8s)", code: "ETIMEDOUT" };
  const c = e?.cause;
  const code = typeof c === "object" && c?.code ? c.code : undefined;
  const parts = [e?.message || String(e)];
  if (typeof c === "object" && c?.message && !parts[0]?.includes(c.message)) parts.push(c.message);
  return { text: parts.filter(Boolean).join(" — "), code: code || undefined };
}

function hintForLlmFailure(text, code) {
  const t = `${text} ${code || ""}`.toLowerCase();
  if (code === "ECONNREFUSED" || t.includes("econnrefused")) {
    return "No server is accepting connections at this URL. Start Ollama (e.g. docker compose up -d ollama), set LLM_BASE_URL to http://127.0.0.1:11434/v1 when the API runs on the host, pull a model: docker compose exec ollama ollama pull " + (config.llm.model || "qwen3:0.6b") + ". Or set LLM_MOCK=true.";
  }
  if (code === "ENOTFOUND" || t.includes("enotfound")) {
    return "Host could not be resolved. If the API runs on the host, use 127.0.0.1 in LLM_BASE_URL; if the API runs in Docker on the same Compose network, use the service name (e.g. ollama).";
  }
  if (code === "ETIMEDOUT" || t.includes("timed out")) {
    return "LLM did not respond in time — it may still be loading the model, or the URL/firewall is wrong.";
  }
    return "Start Ollama (docker compose up -d), pull a model (ollama pull qwen3:0.6b), or set LLM_MOCK=true.";
}

/**
 * OpenAI-compatible servers expose GET /v1/models (baseUrl usually ends with /v1).
 */
export async function checkLlmHttp() {
  if (config.llm.mock) {
    return {
      ok: true,
      skipped: true,
      reason: "LLM_MOCK=true — chat uses templates + RAG only; no LLM HTTP checks needed",
      llmMock: true,
    };
  }

  const base = config.llm.baseUrl.replace(/\/$/, "");
  const modelsUrl = `${base}/models`;
  const t0 = performance.now();

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const apiKey = config.llm.apiKey !== "not-used" ? config.llm.apiKey : "not-used";
    const res = await fetch(modelsUrl, {
      method: "GET",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    clearTimeout(timer);

    const latencyMs = msSince(t0);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
      console.error("[health] llm /models failed:", modelsUrl, err);
      return {
        ok: false,
        error: err,
        modelsUrl,
        latencyMs,
        hint: "Ensure Ollama (or compatible server) is running and reachable from this container",
      };
    }

    let modelIds = [];
    try {
      const data = await res.json();
      modelIds = (data?.data || []).map((m) => m.id).filter(Boolean).slice(0, 12);
    } catch {
      /* non-json */
    }

    const configured = config.llm.model;
    const modelListed = modelIds.length === 0 || modelIds.some((id) => id === configured || id.endsWith(configured.split("/").pop() || ""));

    return {
      ok: true,
      modelsUrl,
      latencyMs,
      configuredModel: configured,
      modelsSample: modelIds,
      modelListed: modelListed || modelIds.length === 0,
      llmMock: false,
    };
  } catch (e) {
    const { text: errText, code: errCode } = formatNodeFetchError(e);
    const hint = hintForLlmFailure(errText, errCode);
    console.error("[health] llm unreachable:", modelsUrl, errText, errCode || "");
    return {
      ok: false,
      error: errText,
      errorCode: errCode,
      modelsUrl,
      latencyMs: msSince(t0),
      hint,
      llmMock: false,
    };
  }
}

/**
 * Full dependency report for GET /health
 */
export async function getHealthReport() {
  const [redisR, qdrantR, pgR, llmR] = await Promise.all([
    checkRedis(),
    checkQdrant(),
    checkPostgres(),
    checkLlmHttp(),
  ]);

  const postgresCore =
    pgR.skipped === true ? true : pgR.ok;
  const coreOk = redisR.ok && qdrantR.ok && postgresCore;
  const llmAcceptable = config.llm.mock || llmR.ok === true;
  let status = "healthy";

  if (!coreOk) {
    status = "unhealthy";
  } else if (!llmAcceptable) {
    status = "degraded";
  }

  const report = {
    ok: coreOk && llmAcceptable,
    status,
    service: "chatbot-api",
    time: new Date().toISOString(),
    config: {
      llmMock: config.llm.mock,
      llmBaseUrl: config.llm.baseUrl,
      llmModel: config.llm.model,
      llmApiKeyConfigured: Boolean(config.llm.apiKey && config.llm.apiKey !== "not-used"),
      usePostgres: config.usePostgres,
      nodeEnv: config.nodeEnv,
    },
    checks: {
      redis: redisR,
      qdrant: qdrantR,
      postgres: pgR,
      llm: llmR,
    },
  };

  if (status === "unhealthy") {
    console.error("[health] UNHEALTHY core dependency failure", JSON.stringify(report.checks));
  } else if (status === "degraded") {
    console.warn("[health] DEGRADED — LLM not reachable (LLM_MOCK=false)", llmR?.error || llmR);
  }

  return report;
}
