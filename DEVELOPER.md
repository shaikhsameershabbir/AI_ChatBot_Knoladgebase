# Developer documentation — AI Support Chatbot

This document is for engineers who build, run, and extend the codebase. End-user / operator quick start stays in [`README.md`](README.md).

---

## 1. System overview

| Layer | Technology | Role |
|-------|------------|------|
| API + static UI | **Node.js 20+**, Express | `POST /chat`, `GET /health`, `GET /api/config`, serves `public/` |
| Embeddings | **Transformers.js** (`@xenova/transformers`) | Local CPU embeddings for RAG (default: `Xenova/all-MiniLM-L6-v2`, 384-dim) |
| Vector store | **Qdrant** | Collection stores chunked markdown + vectors; cosine similarity search |
| Cache | **Redis** | SHA256-keyed reply cache for identical normalized user messages |
| LLM | **OpenAI-compatible HTTP** | Default: **Ollama** at `LLM_BASE_URL` (e.g. `/v1/chat/completions`). Not tied to Ollama specifically. |
| Database (optional) | **PostgreSQL** | Only if `USE_POSTGRES=true` — health check + legacy pool; no LLM tools in current code path |

**Compose (typical dev):** `docker compose up -d` starts **Redis**, **Qdrant**, **Ollama**. The **Node app runs on the host** (`cd chatbot && npm run dev`) so `LLM_BASE_URL` / `REDIS_URL` / `QDRANT_URL` use **`127.0.0.1`**, not Docker service names.

---

## 2. Repository layout

```
├── docker-compose.yml          # redis, qdrant, ollama (+ volumes)
├── scripts/
│   └── pull-ollama-model.sh    # docker compose exec ollama ollama pull <model>
├── db/
│   └── init.sql                # Optional Postgres schema (if you run Postgres yourself)
├── chatbot/
│   ├── package.json
│   ├── Dockerfile              # Optional container build for the API
│   ├── public/
│   │   └── index.html          # Web UI (calls same-origin /chat, /api/config)
│   ├── knowledge/              # *.md only — ingested into Qdrant
│   ├── scripts/
│   │   └── ingest.js           # FORCE_INGEST=true → rebuild collection
│   └── src/
│       ├── app.js              # Express bootstrap, /health, static
│       ├── config/             # env.js, redis.js, qdrant.js, db.js
│       ├── controllers/
│       │   └── chatController.js
│       ├── routes/
│       │   └── chatRoutes.js
│       ├── services/
│       │   ├── cacheService.js
│       │   ├── embeddingService.js
│       │   ├── healthService.js
│       │   ├── llmService.js
│       │   └── vectorService.js
│       └── utils/              # ragRerank, greetings, llmReplySanitize, etc.
├── .env.example
└── README.md
```

---

## 3. Environment variables

Loaded via **`dotenv`** from the **current working directory** when you start Node — typically run commands from **`chatbot/`** with a **`.env`** file there, or export vars in the shell.

| Variable | Default / notes |
|----------|-----------------|
| `PORT` | `3000` |
| `NODE_ENV` | `development` / `production` |
| `CHATBOT_NAME` | Assistant display name |
| `APPLICATION_NAME` | Product name in prompts and UI |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `QDRANT_URL` | `http://127.0.0.1:6333` |
| `QDRANT_COLLECTION` | `application_docs` |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` |
| `RAG_TOP_K` | `5` — chunks passed to the LLM context |
| `CACHE_TTL_SECONDS` | `86400` |
| `LLM_MOCK` | `true` → no HTTP LLM; RAG excerpt / templates only |
| `LLM_BASE_URL` | OpenAI-compatible root, **no trailing slash** (e.g. `http://127.0.0.1:11434/v1`) |
| `LLM_MODEL` | e.g. `qwen3:0.6b` |
| `LLM_API_KEY` / `OPENAI_API_KEY` | Optional; Ollama local often empty |
| `LLM_TEMPERATURE` | Default `0.1` (grounding-friendly) |
| `LLM_MAX_TOKENS` | Default `1024` |
| `LLM_TIMEOUT_MS` | Default `120000` |
| `USE_POSTGRES` | `true` → Postgres health check + `db` pool |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Postgres connection when enabled |

**Ingest:** `FORCE_INGEST=true` is read only by `scripts/ingest.js`, not `env.js`.

---

## 4. HTTP API

### `GET /health`

- **200** when core checks pass (Redis, Qdrant, Postgres if enabled); **`503`** if core unhealthy.
- **`status`**: `healthy` \| `degraded` \| `unhealthy`. **Degraded** often means LLM HTTP check failed while Redis/Qdrant OK.
- Response includes `config` (`llmBaseUrl`, `llmModel`, `llmMock`, `usePostgres`, …) and `checks.*`.

LLM check: `GET {LLM_BASE_URL without trailing slash}/models` (OpenAI-compatible).

### `GET /api/config`

```json
{ "chatbotName": "…", "applicationName": "…" }
```

### `POST /chat`

**Body:** `{ "message": string }` (required).

**Typical success fields:** `reply`, `cached`, `sources` (filenames from RAG), `language`, `intent`, `finishReason`.

**`finishReason` (non-exhaustive):**

| Value | Meaning |
|-------|---------|
| `stop` | Normal LLM completion |
| `mock` | `LLM_MOCK=true` path |
| `mock_knowledge` / `mock_generic` | Mock mode with/without excerpt |
| `greeting` / `smalltalk` | Short-circuit paths |
| `no_retrieval` | Vector search returned **zero** hits (often empty index or Qdrant mismatch) — **not cached** |
| `llm_unavailable_fallback` | LLM threw / timeout; excerpt used if possible |
| `llm_tool_json_fallback` | Reply looked like fake JSON tools; excerpt substituted |

---

## 5. Chat request pipeline (`postChat`)

Order of operations:

1. **Validate** non-empty `message`.
2. **Greeting detector** — if greeting-only, return scripted greeting (no LLM, no RAG).
3. **Redis cache** — key `chat:faq:{CACHE_KEY_VERSION}:{sha256(normalized message)}`. If hit, return cached `reply` immediately (**no RAG**). Bump `CACHE_KEY_VERSION` in `cacheService.js` when you need to invalidate all FAQ caches after prompt/knowledge changes.
4. **Small-talk** short path (optional cached).
5. **`LLM_MOCK`** — vector search + excerpt or generic help; no LLM HTTP.
6. **RAG + LLM:**  
   - `searchSimilar` → Qdrant top-K  
   - `rerankHitsByQuery` — boosts certain `*.md` files by keyword heuristics  
   - If **no hits** → `no_retrieval` response (**not** written to cache)  
   - Else build **system prompt** (strict grounding + preserve names/attributions from snippets)  
   - `runChat` → LangChain `ChatOpenAI` against `LLM_BASE_URL`  
   - Optional sanitization if reply looks like JSON tool calls  
   - Cache successful replies (TTL `CACHE_TTL_SECONDS`), except `no_retrieval`

---

## 6. RAG and ingest

- **Source:** `ingest.js` reads **`chatbot/knowledge/*.md` only** (single directory — not recursive). Markdown in subfolders is ignored unless you change the script. Images and other assets can live under `knowledge/` but are not embedded unless referenced from an ingested `.md` file (text only is vectorized).
- **Chunking:** split on blank lines; paragraphs &gt; ~900 chars split further.
- **Vectors:** 384 dimensions, cosine distance — must match `VECTOR_SIZE` in `vectorService.js`.
- **Rebuild:** `cd chatbot && FORCE_INGEST=true npm run ingest`  
  Deletes and recreates the collection when forcing, then upserts all chunks.

On **startup**, `logCollectionStats()` logs vector count; **0 vectors** means ingest has not been run successfully.

---

## 7. Embeddings

- Implemented in `embeddingService.js` using `@xenova/transformers` (ONNX, local download/cache).
- First run may download model weights — allow time and disk.

---

## 8. LLM integration

- `llmService.js` uses `@langchain/openai` **`ChatOpenAI`** with `baseURL` = `LLM_BASE_URL`, **no** `bindTools` in current code.
- Any server implementing OpenAI-compatible **`/v1/chat/completions`** and **`/v1/models`** (for health) can be used: Ollama, LM Studio, vLLM, or cloud APIs.

---

## 9. Redis cache invalidation

- **Global bump:** change `CACHE_KEY_VERSION` in `chatbot/src/services/cacheService.js`.
- **Nuclear:** `redis-cli FLUSHDB` (same DB the app uses).
- **`no_retrieval` responses are not cached** — fixing Qdrant/ingest does not require clearing cache for that path.

---

## 10. Local development checklist

1. `docker compose up -d` (Redis, Qdrant, Ollama).
2. `docker compose exec ollama ollama pull <LLM_MODEL>` (or `./scripts/pull-ollama-model.sh`).
3. `cd chatbot && cp .env.example .env` — set `LLM_BASE_URL`, `LLM_MODEL`, Redis/Qdrant URLs for **host** networking.
4. `npm install && npm run dev`.
5. `FORCE_INGEST=true npm run ingest`.
6. `curl -s http://localhost:3000/health | jq .` — confirm Qdrant points &gt; 0 and `checks.llm.ok`.

---

## 11. Troubleshooting (dev-focused)

| Symptom | Check |
|---------|--------|
| Always `no_retrieval` | Ingest run? Qdrant URL/collection correct? Startup log vector count? |
| Stale answers after doc change | `FORCE_INGEST=true`; bump cache version or `FLUSHDB` |
| `degraded` health, LLM fails | Ollama up? Model pulled? `LLM_BASE_URL` reachable from Node process? |
| `ECONNREFUSED` to Redis/Qdrant | Ports 6379 / 6333; firewall; wrong `REDIS_URL` / `QDRANT_URL` |
| Embeddings slow first time | Model download; subsequent runs use cache |

---

## 12. Security notes (minimal)

- Do not commit real `.env` files with secrets.
- `POST /chat` JSON body limit **64kb** (`app.js`).
- Prompts instruct the model not to leak secrets; treat RAG content as **trusted input you control**.

---

## 13. License

Same as project [`README.md`](README.md) unless you add a separate license file.
