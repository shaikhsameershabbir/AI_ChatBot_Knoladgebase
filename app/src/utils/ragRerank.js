/**
 * Retrieval order is **not** overridden here — only Qdrant similarity over the full index.
 * The LLM handles language understanding; we avoid hardcoded keyword/typo rules.
 */

/**
 * @param {string} _message
 * @param {Array<{ text?: string, source?: string, score?: number }>} hits
 */
export function rerankHitsByQuery(_message, hits) {
  return hits;
}
