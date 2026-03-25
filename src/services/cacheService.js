import crypto from "crypto";
import { redis } from "../config/redis.js";
import { config } from "../config/env.js";

function normalizeMessage(message) {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Bump when cached answers must be dropped (e.g. after ingest / prompt changes). */
const CACHE_KEY_VERSION = "v3";

export function cacheKey(message) {
  const h = crypto.createHash("sha256").update(normalizeMessage(message)).digest("hex");
  return `chat:faq:${CACHE_KEY_VERSION}:${h}`;
}

/**
 * @param {string} message
 * @returns {Promise<string | null>}
 */
export async function getCachedReply(message) {
  const key = cacheKey(message);
  const v = await redis.get(key);
  return v;
}

/** Same as getCachedReply but never throws (Redis optional for dev). */
export async function getCachedReplySafe(message) {
  try {
    return await getCachedReply(message);
  } catch (e) {
    console.warn("[cache] get skip:", e?.message || e);
    return null;
  }
}

/**
 * @param {string} message
 * @param {string} reply
 */
export async function setCachedReply(message, reply) {
  const key = cacheKey(message);
  await redis.set(key, reply, "EX", config.cacheTtlSeconds);
}

export async function setCachedReplySafe(message, reply) {
  try {
    await setCachedReply(message, reply);
  } catch (e) {
    console.warn("[cache] set skip:", e?.message || e);
  }
}
