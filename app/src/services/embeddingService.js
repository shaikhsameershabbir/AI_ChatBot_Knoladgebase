import { pipeline } from "@xenova/transformers";
import { config } from "../config/env.js";

let extractorPromise;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", config.embeddingModel, {
      quantized: true,
    });
  }
  return extractorPromise;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const data = output.data ?? output;
  if (data && typeof data.length === "number") {
    return Array.from(data);
  }
  if (output.tolist) {
    const t = output.tolist();
    return Array.isArray(t[0]) ? t.flat() : t;
  }
  throw new Error("Unexpected embedding output shape");
}
