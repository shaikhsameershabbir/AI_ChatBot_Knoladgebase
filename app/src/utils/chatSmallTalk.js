const DEVANAGARI = /[\u0900-\u097F]/;

/** Casual chat that is not a product question — answer humanly in mock mode (no RAG dump). */
export function isSmallTalkOnly(raw) {
  const s = raw.trim();
  if (s.length === 0 || s.length > 120) return false;

  if (DEVANAGARI.test(s)) {
    return /^(कैसे\s+हो|आप\s+कैसे\s+हैं|धन्यवाद|शुक्रिया|ठीक\s+है)[।!\s…]*$/u.test(s);
  }

  const m = s.toLowerCase();
  return (
    /^(how\s+are\s+you|how\s+r\s*u|how\s+do\s+you\s+do|howdy)\b/.test(m) ||
    /^(whats\s+up|what's\s+up|wassup|sup)\b/.test(m) ||
    /^(thank\s+you|thanks|thx|ty|thanku)\b/.test(m) ||
    /^(bye|goodbye|see\s+ya|later)\b/.test(m) ||
    /^(ok+|okay|k|cool|nice|great)\s*[!.]*$/i.test(m)
  );
}

/**
 * @typedef {'english' | 'hindi' | 'hinglish'} TalkLang
 * @param {string} message
 * @returns {TalkLang}
 */
export function inferSmallTalkLanguage(message) {
  if (DEVANAGARI.test(message)) return "hindi";
  if (/\b(kaise|aap|shukriya|dhanyavad)\b/i.test(message)) return "hinglish";
  return "english";
}

/**
 * @param {TalkLang} lang
 * @param {string} chatbotName
 * @param {string} applicationName
 */
export function buildSmallTalkReply(lang, chatbotName, applicationName) {
  const name = chatbotName.trim() || "Assistant";
  const app = applicationName.trim() || "the app";

  switch (lang) {
    case "hindi":
      return `मैं ठीक हूँ, धन्यवाद। मैं ${name} हूँ — ${app} में आपकी कैसे मदद करूँ?`;
    case "hinglish":
      return `Main theek hoon, thanks for asking. Main ${name} hoon — ${app} par aapki kaise help karoon?`;
    default:
      return `I'm doing well, thanks for asking. I'm ${name}, and I'm here to help with ${app}. What would you like to know?`;
  }
}
