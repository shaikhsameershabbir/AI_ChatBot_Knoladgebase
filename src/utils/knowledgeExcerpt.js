/**
 * Turn RAG chunks into plain text for display (no # headers, no --- rules).
 * @param {string} text
 */
export function stripMarkdownNoise(text) {
  return text
    .replace(/^#+\s+.*/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimToMaxLen(text, maxLen) {
  if (text.length <= maxLen) return text;
  let out = text.slice(0, maxLen);
  const lastSpace = out.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.55) out = out.slice(0, lastSpace);
  return `${out}…`;
}

/**
 * Prefer the **single best** search hit so mock mode does not stitch unrelated FAQ lines together.
 * @param {Array<{ text?: string, score?: number }>} hits
 * @param {number} maxLen
 * @returns {string | null}
 */
export function buildCleanKnowledgeExcerpt(hits, maxLen = 1100) {
  const valid = hits.filter((h) => h.text?.trim());
  if (valid.length === 0) return null;

  let primary = stripMarkdownNoise(valid[0].text);
  if (primary.length < 80 && valid.length > 1) {
    primary = [primary, stripMarkdownNoise(valid[1].text)].filter(Boolean).join("\n\n").trim();
  }

  const merged = primary.replace(/\n{3,}/g, "\n\n").trim();
  if (merged.length < 40) return null;

  const substantial = merged.split(/\n/).filter((line) => line.replace(/\s/g, "").length > 12);
  if (substantial.length < 1) return null;

  return trimToMaxLen(merged, maxLen);
}
