import { setTimeout as delay } from "timers/promises";
import { config } from "../src/config/env.js";

const base = config.qdrantUrl.replace(/\/$/, "");

for (let i = 0; i < 90; i += 1) {
  try {
    const r = await fetch(`${base}/collections`);
    if (r.ok) {
      process.exit(0);
    }
  } catch {
    /* retry */
  }
  await delay(2000);
}

console.error("[wait-qdrant] timeout");
process.exit(1);
