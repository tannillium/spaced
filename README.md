# Spaced

Spaced is a local-first second brain workspace built as a small full-stack monorepo.

## Stack

- **Next.js + TypeScript + React + Tailwind CSS + Framer Motion + Tiptap** for the workspace, sidebar, rich-text blocks, search, and chat UI. Reusable controls use Radix UI and class-variance-authority.
- **FastAPI + SQLAlchemy** for the REST API and PostgreSQL persistence.
- **Redis** for the indexing stream and short-lived search/answer caching.
- **Qdrant** for chunk embeddings and workspace-scoped semantic retrieval.
- **OpenAI API** for embeddings and grounded assistant responses.
- **Docker Compose** for the local services and background indexer.

## Start the whole stack

1. Install Docker Desktop / Docker Engine with the Compose plugin.
2. Copy `.env.example` to `.env`.
3. Add your `OPENAI_API_KEY` to `.env` to enable indexing and AI chat. The workspace and regular text search work without a key, but semantic indexing and chat will be unavailable.
4. Start the services:

   ```sh
   docker compose up --build
   ```

5. Open <http://localhost:3000>. FastAPI docs are at <http://localhost:8000/docs>.

The first boot creates a Personal workspace and a few starter pages. PostgreSQL, Redis, Qdrant, and uploaded files use named Docker volumes. The default assistant model is GPT-6.2 Sol; change `OPENAI_CHAT_MODEL` to a model available to your API key if needed.

## Local development without Compose

The Next.js page needs the FastAPI service as well. Start PostgreSQL and Redis first. The API can start without Qdrant, but semantic search and AI chat need Qdrant; AI chat also needs an `OPENAI_API_KEY`.

Start the backend in one terminal:

```sh
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
```

The API reads `backend/.env` when launched from that directory. Set `DATABASE_URL`, `REDIS_URL`, and `QDRANT_URL` there for your local services. Then start the frontend in another terminal:

```sh
cd frontend
npm install
npm run dev
```

Set `DATABASE_URL`, `REDIS_URL`, and `QDRANT_URL` for your local services. `frontend/next.config.ts` proxies `/api/*` to `INTERNAL_API_URL` (defaults to `http://127.0.0.1:8000`).

## Data flow

Page edits save to PostgreSQL. The API enqueues index work in a Redis stream; the `indexer` service chunks page/document text, asks OpenAI for embeddings, and upserts source-tagged vectors into Qdrant. Chat embeds each question, retrieves matching chunks inside the workspace boundary, and sends the question plus those excerpts to the OpenAI Responses API. The UI renders the retrieved pages/files as citations. OpenAI response storage is disabled for these calls.

PDF text is extracted with pypdf. Text, Markdown, PDFs, and images are stored under the uploaded-documents volume; only extracted text is indexed. Redis caches RAG responses and semantic search results, and the cache version is advanced when workspace sources change.

## Configuration and current boundaries

`.env.example` lists the local model, database, and vector settings. Never commit `.env` or an API key. The default chat model is configurable through `OPENAI_CHAT_MODEL`; embeddings default to `text-embedding-3-small` with 1536 dimensions. The OpenAI calls use the Responses API and embeddings endpoint described in [OpenAI Docs: Responses](https://developers.openai.com/api/reference/python/resources/responses/methods/create) and [OpenAI Docs: embeddings](https://developers.openai.com/api/docs/guides/embeddings).

This starter uses one default workspace and has no account authentication or multi-user authorization. The Compose database password is for local development only; change it and add authentication before exposing the stack beyond localhost. Schema creation currently uses SQLAlchemy `create_all`; migrations should be added before evolving a deployed database.
