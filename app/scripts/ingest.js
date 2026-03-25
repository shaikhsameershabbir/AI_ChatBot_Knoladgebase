import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { qdrant } from "../src/config/qdrant.js";
import { config } from "../src/config/env.js";
import { embedText } from "../src/services/embeddingService.js";
import { ensureCollection } from "../src/services/vectorService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function chunkText(text, maxLen = 900) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paragraphs) {
    if (p.length <= maxLen) {
      out.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += maxLen) {
      out.push(p.slice(i, i + maxLen));
    }
  }
  return out.length ? out : [text.slice(0, maxLen)];
}

async function main() {
  await ensureCollection();

  const info = await qdrant.getCollection(config.qdrantCollection);
  const existing = Number(info.points_count ?? 0);
  if (existing > 0 && String(process.env.FORCE_INGEST || "").toLowerCase() !== "true") {
    console.log(`[ingest] skip: collection has ${existing} points (set FORCE_INGEST=true to rebuild)`);
    return;
  }

  if (existing > 0) {
    await qdrant.deleteCollection(config.qdrantCollection);
    await ensureCollection();
  }

  const knowledgeDir = path.join(__dirname, "..", "knowledge");
  const files = (await fs.readdir(knowledgeDir)).filter((f) => f.endsWith(".md"));

  const points = [];
  for (const file of files) {
    const full = path.join(knowledgeDir, file);
    const raw = await fs.readFile(full, "utf8");
    const chunks = chunkText(raw);
    for (const text of chunks) {
      const vector = await embedText(text);
      points.push({
        id: randomUUID(),
        vector,
        payload: { text, source: file },
      });
    }
    console.log(`[ingest] ${file}: ${chunks.length} chunks`);
  }

  const batch = 32;
  for (let i = 0; i < points.length; i += batch) {
    const slice = points.slice(i, i + batch);
    await qdrant.upsert(config.qdrantCollection, { wait: true, points: slice });
  }

  console.log(`[ingest] done: ${points.length} vectors`);
}

main().catch((e) => {
  console.error("[ingest] failed", e);
  process.exit(1);
});
