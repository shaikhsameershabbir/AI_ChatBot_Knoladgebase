/**
 * Detect short, greeting-only messages so we can reply in a human tone
 * without dumping RAG chunks in mock mode.
 */

const DEVANAGARI = /[\u0900-\u097F]/;

/** Roman-script casual / English greetings (single intent, short). */
const ROMAN_GREETING =
  /^\s*(hi+|hii|hello|hey|hlo|yo|sup|gm|gn|good\s+(morning|afternoon|evening|night))[\s!.…]*$/i;

/** Hindi script greetings */
const HINDI_GREETING =
  /^\s*(नमस्ते|नमस्कार|प्रणाम|शुभ\s*(प्रभात|दिन|संध्या))[!।\s…]*$/u;

/** Hinglish-style short greetings */
const HINGLISH_GREETING =
  /^\s*(namaste|namaskar|kaise\s+ho|kaise\s+ho\s+aap|kya\s+haal)\??[\s!.…]*$/i;

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function isGreetingOnly(raw) {
  const s = raw.trim();
  if (s.length === 0 || s.length > 48) return false;
  if (DEVANAGARI.test(s)) return HINDI_GREETING.test(s);
  if (HINGLISH_GREETING.test(s)) return true;
  return ROMAN_GREETING.test(s);
}

/**
 * @typedef {'english' | 'hindi' | 'hinglish'} GreetingLang
 */

/**
 * @param {string} message
 * @returns {GreetingLang}
 */
export function inferGreetingLanguage(message) {
  const s = message.trim();
  if (DEVANAGARI.test(s)) return "hindi";
  if (HINGLISH_GREETING.test(s)) return "hinglish";
  return "english";
}

function mirrorEnglishGreetingOpener(raw) {
  const t = raw.trim();
  const gm = t.match(/^good\s+(morning|afternoon|evening|night)[\s!.…]*$/i);
  if (gm) {
    return `Good ${gm[1].toLowerCase()}`;
  }
  const w = t.split(/\s+/)[0] || "Hi";
  if (/^h+i+$/i.test(w)) {
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }
  if (/^hello$/i.test(w)) return "Hello";
  if (/^hey$/i.test(w)) return "Hey";
  return "Hi";
}

/**
 * @param {GreetingLang} lang
 * @param {string} chatbotName
 * @param {string} applicationName
 * @param {string} rawMessage
 */
export function buildGreetingReply(lang, chatbotName, applicationName, rawMessage) {
  const name = chatbotName.trim() || "Assistant";
  const app = applicationName.trim() || "our app";

  switch (lang) {
    case "hindi":
      return [
        `नमस्ते, मैं ${name} हूँ।`,
        `आज मैं आपकी कैसे मदद कर सकता हूँ? मैं ${app} से जुड़े आपके सवालों का जवाब हमारी ज्ञान सामग्री से तैयार करके दे सकता हूँ।`,
      ].join(" ");
    case "hinglish":
      return [
        `Hi, main ${name} hoon.`,
        `Aaj main aapki kaise madad kar sakta hoon? Main ${app} se jude sawaalon par natural jawab de sakta hoon — bas jo puchna ho likhiye.`,
      ].join(" ");
    default: {
      const opener = mirrorEnglishGreetingOpener(rawMessage);
      return [
        `${opener}, I'm ${name}. How can I help you today?`,
        `I can help with questions about ${app} — ask me anything, and I'll answer from our product knowledge.`,
      ].join(" ");
    }
  }
}
