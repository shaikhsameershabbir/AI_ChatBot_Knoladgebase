# AI Support Chatbot Architecture (Node.js + Self Hosted LLM)

> **Deployment note:** The runnable project uses **Ollama** (small local LLM, OpenAI-compatible API, CPU-friendly) in `docker-compose.yml`. Sections below may still mention vLLM as an alternative inference server.

> **End-user answers:** The assistant must reply in **plain sentences only**. Snippets below may mention APIs or architecture for maintainers — those are **not** templates to copy into chat (no JSON, no fake `function` / `tool` blocks).

## Goal
Build a **self‑hosted AI support chatbot** that can answer questions about the application, support:

- English
- Hindi
- Hinglish (e.g. "Mujhe login kaise karna hai")

The bot should:

- Understand application documentation
- Answer FAQs from retrieved docs (RAG)
- Run fully on our infrastructure
- Be containerized with Docker

---

# Authoritative runtime reference (this repository)

Use **only** this section for factual questions about how **this** chatbot is wired (health endpoint, model name, services). Older sections below may mention alternatives (vLLM, larger models) for comparison — **do not treat those as the live deployment** unless this section says otherwise.

## HTTP endpoints (API)

- **`POST /chat`** — JSON body: `{ "message": "..." }`. Returns a JSON reply with a `reply` string (and metadata such as `sources`, `finishReason`). This is the user-facing chat.
- **`GET /health`** — JSON **dependency report** for operators. Typical top-level fields:
  - `ok` (boolean), `status` (`"healthy"` | `"degraded"` | `"unhealthy"`), `service` (e.g. `"chatbot-api"`), `time` (ISO timestamp).
  - `config`: `llmMock`, `llmBaseUrl`, `llmModel`, `llmApiKeyConfigured`, `usePostgres`, `nodeEnv`.
  - `checks.redis`: `ok`, `latencyMs`.
  - `checks.qdrant`: `ok`, `latencyMs`, `collection`, `points` (vector count).
  - `checks.postgres`: either `skipped: true` when Postgres is not enabled, or `ok` / error details when `USE_POSTGRES=true`.
  - `checks.llm`: e.g. `ok`, `modelsUrl`, `latencyMs`, `configuredModel`, `modelListed`, `modelsSample` (list of model ids Ollama reports).

`status` is **`degraded`** if core dependencies (Redis, Qdrant, Postgres when enabled) are fine but the **LLM HTTP check** fails (e.g. Ollama down). It is **`unhealthy`** if a core check fails.

**Do not invent** CPU percentages, memory figures, or generic “system health” metrics — those are **not** part of `/health` in this project.

## LLM and inference (this deployment)

- The app talks to an **OpenAI-compatible** HTTP API (`LLM_BASE_URL`, usually ending in `/v1`). **Ollama** is the typical local server; it serves models and exposes `/v1/chat/completions` and `/v1/models`.
- The **configured model id** comes from **`LLM_MODEL`** (for example **`qwen3:0.6b`**). The **exact** id in production is whatever is set in the environment; **`GET /health`** echoes it under `config.llmModel` and `checks.llm.configuredModel`.
- **`LLM_MOCK=true`** means no live LLM HTTP calls (template/knowledge-only behaviour).

## Data and cache

- **Redis**: reply cache (not the source of truth for facts).
- **Qdrant**: embeddings for markdown under `chatbot/knowledge/`; collection name is configurable (default **`application_docs`**).
- **PostgreSQL**: optional; health check only when **`USE_POSTGRES=true`**. Not required for basic chat + RAG.

---

# High Level Architecture

```
User
 │
 ▼
Frontend Chat Widget
 │
 ▼
Node.js API (Chatbot Service)
 │
 ├── Redis (Cache)
 │
 ├── Vector Database (Qdrant)
 │
 ├── LLM Server (e.g. Ollama)
 │
 └── (Optional) data stores for product features — not shown to users as JSON
```

---

# Core Components

## 1. LLM Inference Server

**Production-style setup in this repo:** **Ollama** (OpenAI-compatible `/v1` on port **11434** by default). Model id is configured with **`LLM_MODEL`** (see **Authoritative runtime reference** above).

Alternative setups may use **vLLM** or other servers; those are **not** the default for this codebase. Do not confuse example vLLM ports or example model names with the **live** `LLM_MODEL` unless the user’s knowledge snippets explicitly say so.

Responsibilities:

- Generate answers
- Understand multilingual queries
- Follow system prompt rules

---

## 2. Node.js Chatbot API

The Node.js service orchestrates everything.

Responsibilities:

- Accept user messages
- Detect language
- Check what type of question is this (suppost, sale , etc )
- Retrieve knowledge from vector database
- Call LLM to turn retrieved context into a clear, human answer
- Return plain-text responses (no JSON tool payloads to the user)

Tech stack:

```
Node.js
Express
LangChain
Redis
Axios
```

Main endpoint:

```
POST /chat
```

Request (public chat API):

```
{
  "message": "Mujhe login kaise karna hai?"
}
```

---

# Retrieval Augmented Generation (RAG)

The chatbot should **not be fine tuned**.

Instead we use **RAG**.

Flow:

```
User Question
   │
   ▼
Vector Search (Qdrant)
   │
   ▼
Relevant Documents
   │
   ▼
Context + User Question
   │
   ▼
LLM
   │
   ▼
Answer
```

---

# Knowledge Base

Application documentation should be stored as markdown files.

Example structure:

```
knowledge/

login.md
payments.md
profile.md
settings.md
api.md
faq.md
```

These documents are embedded and stored in Qdrant.

---

# Vector Database

We use **Qdrant**.

Responsibilities:

- Store embeddings
- Semantic search
- Retrieve relevant docs

Collection example:

```
application_docs
```

---

# Optional backend data

Some deployments connect optional services (cache, vector DB, etc.) on the server. **End users only see natural-language replies**, not SQL, JSON tool calls, or internal API shapes.

---

# Redis Cache

Redis stores frequently asked questions.

Example cached query:

```
"How to reset password"
```

Benefits:

- reduce LLM calls
- faster responses

---

# Language Handling

The system prompt enforces multilingual support.

Example prompt:

```
You are the AI assistant of our application.

Rules:

Answer only questions related to our application.

Support:

English
Hindi
Hinglish

Always respond in the same language as the user.

If the answer is not in the knowledge base say:

"Please contact support."
```

---

# Node.js Project Structure

```
chatbot/

src/

controllers/
chatController.js

services/
llmService.js
vectorService.js
cacheService.js

routes/
chatRoutes.js

config/
db.js
redis.js

app.js

Dockerfile

package.json
```

---

# Example Chat Flow

```
User Message

"Mera payment pending kyu hai?"

Step 1
API receives message

Step 2
Search vector database

Step 3
Retrieve relevant docs

Step 4
Send prompt to LLM

Step 5
LLM generates answer

Step 6
Return response
```

---

# Docker Architecture

We run everything using Docker Compose.

Services:

```
chatbot-api
vllm-server
qdrant
redis
postgres
```

---

# docker-compose.yml

```
version: '3.9'

services:

  chatbot:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - qdrant
      - redis
      - vllm

  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"

  redis:
    image: redis
    ports:
      - "6379:6379"

  postgres:
    image: postgres
    environment:
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"

  vllm:
    image: vllm/vllm-openai
    command: >
      --model meta-llama/Meta-Llama-3-8B-Instruct
    ports:
      - "8000:8000"
```

---

# Node Dockerfile

```
FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "src/app.js"]
```

---

# API Endpoint

POST /chat

Example:

```
curl -X POST http://localhost:3000/chat \
-H "Content-Type: application/json" \
-d '{"message":"Mujhe login kaise karna hai"}'
```

---

# Scalability

To support high traffic:

- enable Redis caching
- scale Node containers
- enable request batching in vLLM

Example:

```
docker compose up --scale chatbot=4
```

---

# Security Rules

The chatbot must:

- never expose database schema
- never leak internal APIs
- answer only application related queries

---

# Future Improvements

Possible upgrades:

- conversation memory
- user context
- analytics dashboard
- feedback loop
- admin panel for knowledge management

---

# Summary

This system provides:

- self hosted AI
- multilingual support
- RAG based knowledge retrieval
- Docker based deployment

The stack is designed to be lightweight, scalable and fully controllable by our infrastructure.

