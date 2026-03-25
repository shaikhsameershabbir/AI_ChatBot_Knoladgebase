import { qdrant } from "../config/qdrant.js";
import { config } from "../config/env.js";
import { embedText } from "./embeddingService.js";

const VECTOR_SIZE = 384;

export async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === config.qdrantCollection);
  if (!exists) {
    await qdrant.createCollection(config.qdrantCollection, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
}

/** Log once at startup so operators know RAG is empty until ingest runs. */
export async function logCollectionStats() {
  try {
    const info = await qdrant.getCollection(config.qdrantCollection);
    const n = Number(info.points_count ?? 0);
    if (n === 0) {
      console.warn(
        `[startup] Qdrant collection "${config.qdrantCollection}" has 0 vectors — chat answers will be empty until you run: cd chatbot && FORCE_INGEST=true npm run ingest`,
      );
    } else {
      console.log(`[startup] Qdrant "${config.qdrantCollection}": ${n} vectors (RAG ready)`);
    }
  } catch (e) {
    console.warn("[startup] Could not read Qdrant collection stats:", e?.message || e);
  }
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<{ text: string, source: string, score: number }[]>}
 */
export async function searchSimilar(query, limit = config.ragTopK) {
  const q = String(query ?? "").trim().slice(0, 8000);
  const vector = await embedText(q);
  const res = await qdrant.search(config.qdrantCollection, {
    vector,
    limit,
    with_payload: true,
  });
  return res.map((r) => ({
    text: String(r.payload?.text ?? ""),
    source: String(r.payload?.source ?? "unknown"),
    score: typeof r.score === "number" ? r.score : 0,
  }));
}

export { VECTOR_SIZE };
