import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config/env.js";
import { chatRoutes } from "./routes/chatRoutes.js";
import { ensureCollection, logCollectionStats } from "./services/vectorService.js";
import { getHealthReport } from "./services/healthService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

app.get("/health", async (_req, res) => {
  try {
    const report = await getHealthReport();
    const code = report.status === "unhealthy" ? 503 : 200;
    res.status(code).json(report);
  } catch (e) {
    console.error("[health] handler error:", e?.stack || e?.message || e);
    res.status(503).json({
      ok: false,
      status: "error",
      service: "chatbot-api",
      error: String(e?.message || e),
      time: new Date().toISOString(),
    });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    chatbotName: config.chatbotName,
    applicationName: config.applicationName,
  });
});

app.use(chatRoutes);

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

async function main() {
  await ensureCollection().catch((e) => {
    console.error("[startup] qdrant ensureCollection failed", e.message);
  });
  await logCollectionStats().catch(() => {});

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`chatbot-api listening on :${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
