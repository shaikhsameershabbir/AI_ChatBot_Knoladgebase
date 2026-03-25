# AI Support Chatbot

**Developer documentation:** [`DEVELOPER.md`](DEVELOPER.md) (architecture, API, env, RAG pipeline, troubleshooting).

Self-hosted **RAG** chatbot: **Node.js (Express)** serves the API and UI; **Qdrant** stores embeddings from `chatbot/knowledge/*.md`; **Redis** caches replies; **Ollama** runs a **local** LLM via an **OpenAI-compatible** API (`/v1`). **PostgreSQL** is optional (health check only) when you set **`USE_POSTGRES=true`**. No paid model API is required, and **no GPU** is required for small models (CPU is slower but works).

## Architecture (short)

```
User → Web UI / POST /chat → Node.js
                              ├─ Redis (cache)
                              ├─ Qdrant (semantic search over knowledge chunks)
                              ├─ PostgreSQL (optional — `USE_POSTGRES=true` for health check)
                              └─ Ollama (LLM synthesis when LLM_MOCK=false)
```

## Features

| Endpoint | Purpose |
|----------|---------|
| **POST `/chat`** | JSON: `{ "message": "..." }` — RAG + optional LLM |
| **GET `/health`** | Redis, Qdrant, optional Postgres (if `USE_POSTGRES=true`), and (if not mock) **GET `/v1/models`** on the LLM; **`503`** if core deps fail; **`200`** with **`status": "degraded"`** if only the LLM is unreachable |
| **GET `/api/config`** | `{ "chatbotName", "applicationName" }` for the UI |

**Modes**

- **`LLM_MOCK=true`** — No calls to Ollama; templates + retrieved knowledge excerpts only.
- **`LLM_MOCK=false`** — **RAG + Ollama** (recommended for natural, context-aware answers).

## Repository layout

| Path | Purpose |
|------|---------|
| `chatbot/` | Node app (`src/`), `public/`, `Dockerfile` |
| `chatbot/knowledge/` | Markdown knowledge base → embedded into Qdrant |
| `db/init.sql` | Postgres init + demo rows |
| `docker-compose.yml` | **redis**, **qdrant**, **ollama** (run the Node app locally; see below) |
| `scripts/pull-ollama-model.sh` | Helper: `ollama pull` inside the Ollama container |
| `.env.example` | Copy to `.env` |

## Prerequisites

- **Docker** + **Docker Compose** v2
- **RAM**: depends on Ollama model (e.g. **qwen3:0.6b** is light; larger models need more)

## Quick start (recommended: infra in Docker, app on the host)

**1. Start Redis, Qdrant, and Ollama** (from the directory that contains `docker-compose.yml`):

```bash
docker compose up -d
```

**2. Pull the LLM once** (stored in the `ollama_data` volume):

```bash
docker compose exec ollama ollama pull qwen3:0.6b
```

Or: `./scripts/pull-ollama-model.sh`

**3. Run the chatbot API locally** (uses **localhost** ports published by Docker):

```bash
cd chatbot
cp .env.example .env
npm install
npm run dev
```

- UI: **http://localhost:3000**  
- Health: **http://localhost:3000/health** — expect **`checks.llm.ok": true`** after the model is pulled.

Use **`127.0.0.1`** in **`chatbot/.env`** for **`REDIS_URL`**, **`QDRANT_URL`**, and **`LLM_BASE_URL`** (not Docker service names like `ollama` — those only work inside Compose networks).

```bash
docker compose down
```

### Ports

| Service | Host port |
|---------|-----------|
| Chatbot (local Node) | **3000** (default `PORT`) |
| Ollama | **11434** |
| Redis | **6379** |
| Qdrant | **6333** |

### Optional: PostgreSQL health check

If you run Postgres yourself, set **`USE_POSTGRES=true`** and **`PGHOST` / `PGDATABASE` / …** in **`chatbot/.env`**. Default Compose does not include Postgres.

## Verify production-like behaviour

1. `.env`: **`LLM_MOCK=false`**, **`LLM_BASE_URL`** and **`LLM_MODEL`** match your Ollama setup.
2. Health:

   ```bash
   curl -s http://localhost:3000/health | jq .
   ```

   Aim for **`status": "healthy"`** and **`checks.llm.ok": true`**.

3. Chat:

   ```bash
   curl -s -X POST http://localhost:3000/chat \
     -H "Content-Type: application/json" \
     -d '{"message":"What is the goal of this project?"}' | jq .
   ```

   If **`finishReason`** is **`llm_unavailable_fallback`**, the LLM call failed — check Ollama logs and `/health`.

### Optional: cloud OpenAI-compatible API

Set **`LLM_BASE_URL`**, **`LLM_MODEL`**, and **`LLM_API_KEY`** (or **`OPENAI_API_KEY`**). Ollama local usually needs **no** key.

## Knowledge base (RAG)

- Add or edit Markdown under **`chatbot/knowledge/`**.
- Rebuild vectors after changes:

  ```bash
  cd chatbot && FORCE_INGEST=true npm run ingest
  ```

- If stale or wrong snippets appear, flush Redis:

  ```bash
  docker compose exec redis redis-cli FLUSHDB
  ```

Retrieval uses **embeddings** over the **entire** ingested knowledge index (no keyword → file rules).

## Environment variables

| Variable | Description |
|----------|-------------|
| `CHATBOT_NAME` | Assistant name in UI and greetings |
| `APPLICATION_NAME` | Product name in prompts |
| `LLM_MOCK` | `true` = no Ollama; `false` = use `LLM_BASE_URL` |
| `LLM_BASE_URL` | OpenAI-compatible root, e.g. `http://ollama:11434/v1` (Compose) |
| `LLM_MODEL` | Ollama model id, e.g. `qwen3:0.6b` |
| `LLM_API_KEY` | Optional (Ollama local: empty) |
| `LLM_TIMEOUT_MS` | Default **120000** ms (CPU inference can be slow) |
| `USE_POSTGRES` | `true` to run the Postgres health check (default off) |
| `FORCE_INGEST` | `true` with `npm run ingest` → rebuild Qdrant collection from `knowledge/` |

See **`.env.example`**.

## Logs

```bash
docker compose logs -f ollama
# API (local): watch the terminal where you ran npm run dev
```

## Troubleshooting

| Issue | What to do |
|-------|------------|
| **`status": "degraded"`**, LLM `ok: false` | Ollama not running or model not pulled — run `docker compose exec ollama ollama pull …`; ensure **`LLM_BASE_URL`** in **`chatbot/.env`** is **`http://127.0.0.1:11434/v1`** when Node runs on the host. |
| **`LLM_MOCK=true`** but you want synthesis | Set **`LLM_MOCK=false`** in **`chatbot/.env`** and restart **`npm run dev`**. |
| Slow replies | Normal on **CPU**; use a smaller model, or attach **GPU** to Ollama later; increase **`LLM_TIMEOUT_MS`**. |
| Wrong answers from old docs | **`FORCE_INGEST=true npm run ingest`** in **`chatbot/`**; **`FLUSHDB`** Redis. |
| Chat always says help isn’t found / **`finishReason": "no_retrieval"`** | Qdrant has **no vectors** until ingest. Run **`cd chatbot && FORCE_INGEST=true npm run ingest`** with Qdrant up. On startup, logs show **`0 vectors`** vs **`RAG ready`**. |

## License

Use and modify for your project as needed.
