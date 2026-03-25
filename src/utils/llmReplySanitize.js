/**
 * Small local models sometimes echo JSON "function call" shapes (especially when RAG
 * snippets contain API/tool examples). Detect that and treat it as invalid for users.
 * @param {string} text
 */
export function looksLikeToolOrFunctionJson(text) {
  const t = (text ?? "").trim();
  if (t.length < 10) return false;

  const compact = t.replace(/\s+/g, " ");
  if (/["']function["']\s*:\s*["']/.test(compact)) return true;
  if (/\{\s*["']function["']/.test(t)) return true;
  if (/"tool_calls"\s*:/.test(t)) return true;
  if (/\{\s*"name"\s*:\s*"getuser/i.test(t)) return true;
  if (/getuserproject/i.test(t) && /\{/.test(t) && /"parameters"/.test(t)) return true;
  if (/^\s*\{[\s\S]*"parameters"[\s\S]*"userId"/i.test(t)) return true;

  return false;
}
