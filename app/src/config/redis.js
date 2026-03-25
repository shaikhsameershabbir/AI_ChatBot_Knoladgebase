import Redis from "ioredis";
import { config } from "./env.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err) => {
  console.error("[redis] error", err.message);
});
