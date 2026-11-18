import io
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import AsyncOpenAI
from pypdf import PdfReader
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal, engine, get_session, initialize_database
from app.models import Document, Page, Workspace
from app.schemas import ChatRequest, ChatResponse, DocumentOut, PageCreate, PageOut, PageUpdate, SearchHit
from app.services.jobs import GROUP, INDEX_STREAM, enqueue_index
from app.services.rag import answer_question
from app.services.text import document_json_to_text
from app.services.vector import ensure_collection, retrieve

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("spaced.api")


def seeded_doc(title: str, paragraphs: list[tuple[str, str]]) -> dict:
    content = []
    for kind, text in paragraphs:
        text_node = {"type": "text", "text": text}
        if kind == "heading":
            content.append({"type": "heading", "attrs": {"level": 2}, "content": [text_node]})
        elif kind == "bulletList":
            content.append({"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [text_node]}]}]})
        elif kind == "blockquote":
            content.append({"type": "blockquote", "content": [{"type": "paragraph", "content": [text_node]}]})
        else:
            content.append({"type": "paragraph", "content": [text_node]})
    return {"type": "doc", "content": content}


async def ensure_workspace() -> None:
    async with SessionLocal() as session:
        workspace = await session.get(Workspace, settings.default_workspace_id)
        if workspace is None:
            session.add(Workspace(id=settings.default_workspace_id, name="Personal workspace"))
            await session.commit()
        count = await session.scalar(select(Page.id).where(Page.workspace_id == settings.default_workspace_id).limit(1))
        if count:
            return
        pages = [
            Page(id=UUID("00000000-0000-4000-8000-000000000101"), workspace_id=settings.default_workspace_id, title="Welcome to Spaced", icon="✳", favorite=True, blocks=seeded_doc("Welcome", [("paragraph", "Your mind has a little more room now."), ("paragraph", "Spaced is a home for the notes, plans, and passing thoughts you want to keep. Make a page, write something down, and let your ideas find their place."), ("heading", "Make yourself at home"), ("bulletList", "Create pages for projects, classes, and everything in between."), ("bulletList", "Use Ask Spaced to find information across your saved workspace."), ("blockquote", "A good second brain should feel like a quiet room, not another inbox.")])),
            Page(id=UUID("00000000-0000-4000-8000-000000000102"), workspace_id=settings.default_workspace_id, title="SPACED · Product roadmap", icon="🪴", favorite=True, blocks=seeded_doc("Roadmap", [("paragraph", "A living outline for what we are building and why."), ("heading", "North star"), ("paragraph", "Give curious people a calm, connected place to think, make, and remember."), ("heading", "Now · Foundation"), ("paragraph", "Build a fast, reliable editor. Make pages easy to find and organize. Keep everything saved by default."), ("heading", "Next · Knowledge"), ("paragraph", "Import source documents. Search notes and cite useful passages.")])),
            Page(id=UUID("00000000-0000-4000-8000-000000000103"), workspace_id=settings.default_workspace_id, title="Studio sync · 18 Nov", icon="🗒️", favorite=False, blocks=seeded_doc("Meeting notes", [("paragraph", "Weekly product check-in · Tuesday afternoon"), ("heading", "What we covered"), ("paragraph", "Keep the first-run experience focused on writing, not setup. Try a softer gray palette and compact workspace navigation."), ("heading", "Action items"), ("paragraph", "Sketch a workspace landing page. Ask a few friends to test page search. Write down what should stay local versus synced.")])),
            Page(id=UUID("00000000-0000-4000-8000-000000000104"), workspace_id=settings.default_workspace_id, title="Research library", icon="📚", favorite=False, blocks=seeded_doc("Research", [("paragraph", "Clips, reading notes, and useful references."), ("heading", "Reading list"), ("paragraph", "The extended mind · Andy Clark and David Chalmers. How to take smart notes · Sönke Ahrens.")]))
        ]
        session.add_all(pages)
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await initialize_database()
    await ensure_workspace()
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    await app.state.redis.ping()
    qdrant = AsyncQdrantClient(url=settings.qdrant_url)
    try:
        await ensure_collection(qdrant)
        app.state.qdrant = qdrant
    except Exception as exc:
        logger.warning("Qdrant is unavailable; semantic search is disabled: %s", exc)
        await qdrant.close()
        app.state.qdrant = None
    secret = settings.openai_api_key.get_secret_value() if settings.openai_api_key else None
    app.state.openai = AsyncOpenAI(api_key=secret) if secret else None
    try:
        await app.state.redis.xgroup_create(INDEX_STREAM, GROUP, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            raise
    yield
    await app.state.redis.aclose()
    if app.state.qdrant:
        await app.state.qdrant.close()
    if app.state.openai:
        await app.state.openai.close()
    await engine.dispose()


app = FastAPI(title="Spaced API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def workspace_id() -> UUID:
    return settings.default_workspace_id


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def get_qdrant(request: Request) -> AsyncQdrantClient | None:
    return request.app.state.qdrant


def get_openai(request: Request) -> AsyncOpenAI:
    client = request.app.state.openai
    if client is None:
        raise HTTPException(status_code=503, detail="OpenAI is not configured. Set OPENAI_API_KEY in .env and restart the services.")
    return client


async def invalidate_cache(redis: Redis, workspace: UUID) -> None:
    await redis.incr(f"spaced:cache:version:{workspace}")


def document_response(document: Document) -> DocumentOut:
    output = DocumentOut.model_validate(document)
    return output.model_copy(update={"file_url": f"/api/documents/{document.id}/file"})


async def assert_page_parent(session: AsyncSession, page_id: UUID | None, workspace: UUID) -> None:
    if page_id is None:
        return
    page = await session.get(Page, page_id)
    if page is None or page.workspace_id != workspace:
        raise HTTPException(status_code=404, detail="Parent page not found")


async def descendant_ids(session: AsyncSession, root_id: UUID, workspace: UUID) -> list[UUID]:
    rows = (await session.execute(select(Page.id, Page.parent_id).where(Page.workspace_id == workspace))).all()
    children: dict[UUID, list[UUID]] = {}
    for page_id, parent_id in rows:
        if parent_id:
            children.setdefault(parent_id, []).append(page_id)
    result: list[UUID] = []
    pending = [root_id]
    while pending:
        current = pending.pop()
        result.append(current)
        pending.extend(children.get(current, []))
    return result


@app.get("/health")
async def health(request: Request) -> dict:
    return {"status": "ok", "postgres": "connected", "redis": "connected", "qdrant": "connected" if request.app.state.qdrant else "unavailable", "openai_configured": request.app.state.openai is not None}


@app.get("/api/pages", response_model=list[PageOut])
async def list_pages(session: AsyncSession = Depends(get_session)):
    result = await session.scalars(select(Page).where(Page.workspace_id == workspace_id()).order_by(Page.created_at.asc()))
    return list(result)


@app.post("/api/pages", response_model=PageOut, status_code=201)
async def create_page(payload: PageCreate, redis: Redis = Depends(get_redis), session: AsyncSession = Depends(get_session)):
    await assert_page_parent(session, payload.parent_id, workspace_id())
    page = Page(workspace_id=workspace_id(), **payload.model_dump())
    session.add(page)
    await session.commit()
    await session.refresh(page)
    await enqueue_index(redis, "index", "page", page.id, page.workspace_id)
    await invalidate_cache(redis, page.workspace_id)
    return page


@app.post("/api/pages/{page_id}/open", response_model=PageOut)
async def open_page(page_id: UUID, session: AsyncSession = Depends(get_session)):
    page = await session.get(Page, page_id)
    if page is None or page.workspace_id != workspace_id():
        raise HTTPException(status_code=404, detail="Page not found")
    from datetime import datetime, timezone
    page.last_opened_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(page)
    return page


@app.patch("/api/pages/{page_id}", response_model=PageOut)
async def update_page(page_id: UUID, payload: PageUpdate, request: Request, redis: Redis = Depends(get_redis), session: AsyncSession = Depends(get_session)):
    page = await session.get(Page, page_id)
    if page is None or page.workspace_id != workspace_id():
        raise HTTPException(status_code=404, detail="Page not found")
    changes = payload.model_dump(exclude_unset=True)
    if "parent_id" in changes:
        await assert_page_parent(session, changes["parent_id"], page.workspace_id)
        if changes["parent_id"] == page.id:
            raise HTTPException(status_code=400, detail="A page cannot be nested inside itself")
        if changes["parent_id"]:
            children = await descendant_ids(session, page.id, page.workspace_id)
            if changes["parent_id"] in children:
                raise HTTPException(status_code=400, detail="Moving the page there would create a cycle")
    for key, value in changes.items():
        setattr(page, key, value)
    await session.commit()
    await session.refresh(page)
    if "blocks" in changes or "title" in changes:
        await enqueue_index(redis, "index", "page", page.id, page.workspace_id)
    await invalidate_cache(redis, page.workspace_id)
    return page


@app.delete("/api/pages/{page_id}", status_code=204)
async def delete_page(page_id: UUID, redis: Redis = Depends(get_redis), session: AsyncSession = Depends(get_session)):
    page = await session.get(Page, page_id)
    if page is None or page.workspace_id != workspace_id():
        raise HTTPException(status_code=404, detail="Page not found")
    ids = await descendant_ids(session, page.id, page.workspace_id)
    workspace = page.workspace_id
    await session.delete(page)
    await session.commit()
    for source_id in ids:
        await enqueue_index(redis, "delete", "page", source_id, workspace)
    await invalidate_cache(redis, workspace)


@app.get("/api/documents", response_model=list[DocumentOut])
async def list_documents(session: AsyncSession = Depends(get_session)):
    documents = await session.scalars(select(Document).where(Document.workspace_id == workspace_id()).order_by(Document.created_at.desc()))
    return [document_response(document) for document in documents]


@app.post("/api/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    source_page_id: UUID | None = None,
    redis: Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
):
    workspace = workspace_id()
    await assert_page_parent(session, source_page_id, workspace)
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(status_code=415, detail="Upload a PDF, image, text, or Markdown file")
    raw = await file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Files are limited to 25 MB")
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        extracted = ""
    elif suffix == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(raw))
            extracted = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read this PDF") from exc
    else:
        extracted = raw.decode("utf-8", errors="replace")
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    document_id = __import__("uuid").uuid4()
    storage_path = settings.upload_dir / str(document_id)
    storage_path.write_bytes(raw)
    document = Document(
        id=document_id,
        workspace_id=workspace,
        source_page_id=source_page_id,
        name=filename,
        mime_type={".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/plain", ".markdown": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[suffix],
        size_bytes=len(raw),
        extracted_text=extracted,
        storage_path=str(storage_path),
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    await enqueue_index(redis, "index", "document", document.id, workspace)
    await invalidate_cache(redis, workspace)
    return document_response(document)


@app.get("/api/documents/{document_id}/file")
async def get_document_file(document_id: UUID, session: AsyncSession = Depends(get_session)):
    document = await session.get(Document, document_id)
    if document is None or document.workspace_id != workspace_id():
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(document.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing")
    return FileResponse(path, media_type=document.mime_type, filename=document.name, content_disposition_type="inline")


@app.delete("/api/documents/{document_id}", status_code=204)
async def delete_document(document_id: UUID, redis: Redis = Depends(get_redis), session: AsyncSession = Depends(get_session)):
    document = await session.get(Document, document_id)
    if document is None or document.workspace_id != workspace_id():
        raise HTTPException(status_code=404, detail="Document not found")
    workspace = document.workspace_id
    source_path = Path(document.storage_path)
    await session.delete(document)
    await session.commit()
    source_path.unlink(missing_ok=True)
    await enqueue_index(redis, "delete", "document", document_id, workspace)
    await invalidate_cache(redis, workspace)


@app.get("/api/search", response_model=list[SearchHit])
async def search_workspace(
    request: Request,
    q: str,
    redis: Redis = Depends(get_redis),
    qdrant: AsyncQdrantClient | None = Depends(get_qdrant),
    session: AsyncSession = Depends(get_session),
):
    query = q.strip()
    if not query:
        return []
    openai: AsyncOpenAI | None = request.app.state.openai
    if openai is None:
        from sqlalchemy import String, cast
        pages = await session.scalars(select(Page).where(Page.workspace_id == workspace_id(), Page.title.ilike(f"%{query}%") | cast(Page.blocks, String).ilike(f"%{query}%")).limit(12))
        documents = await session.scalars(select(Document).where(Document.workspace_id == workspace_id(), Document.name.ilike(f"%{query}%") | Document.extracted_text.ilike(f"%{query}%")).limit(12))
        page_hits = [SearchHit(source_id=p.id, source_type="page", title=p.title, excerpt=document_json_to_text(p.blocks)[:400], score=1) for p in pages]
        file_hits = [SearchHit(source_id=d.id, source_type="document", title=d.name, excerpt=d.extracted_text[:400], score=1) for d in documents]
        return page_hits + file_hits
    if qdrant is None:
        raise HTTPException(status_code=503, detail="Qdrant is unavailable. Start Qdrant to enable semantic search.")
    version = await redis.get(f"spaced:cache:version:{workspace_id()}") or "0"
    key = f"spaced:search:{workspace_id()}:{version}:{__import__('hashlib').sha256(query.lower().encode()).hexdigest()}"
    cached = await redis.get(key)
    if cached:
        return [SearchHit.model_validate(item) for item in json.loads(cached)]
    vector = await openai.embeddings.create(model=settings.openai_embedding_model, input=query, dimensions=settings.embedding_dimensions, encoding_format="float")
    citations = await retrieve(qdrant, workspace_id(), vector.data[0].embedding, limit=12)
    hits = [SearchHit(source_id=c.source_id, source_type=c.source_type, title=c.title, excerpt=c.excerpt, score=c.score) for c in citations]
    await redis.set(key, json.dumps([hit.model_dump(mode="json") for hit in hits]), ex=180)
    return hits


@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    redis: Redis = Depends(get_redis),
    qdrant: AsyncQdrantClient | None = Depends(get_qdrant),
    openai: AsyncOpenAI = Depends(get_openai),
):
    if qdrant is None:
        raise HTTPException(status_code=503, detail="Qdrant is unavailable. Start Qdrant to enable workspace AI.")
    try:
        return await answer_question(
            query=payload.query,
            history=payload.history,
            workspace_id=workspace_id(),
            redis=redis,
            qdrant=qdrant,
            openai=openai,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Assistant request failed")
        raise HTTPException(status_code=502, detail="The workspace assistant could not complete this request") from exc


@app.get("/api/workspace")
async def get_workspace():
    return {"id": str(settings.default_workspace_id), "name": "Personal workspace"}
