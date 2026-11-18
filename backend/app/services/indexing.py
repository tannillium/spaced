import logging
from uuid import UUID

from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Document, Page
from app.services.text import batch, chunk_text, document_json_to_text
from app.services.vector import point_id, remove_source

logger = logging.getLogger(__name__)


async def index_source(
    session: AsyncSession,
    qdrant: AsyncQdrantClient,
    openai: AsyncOpenAI,
    operation: str,
    source_type: str,
    source_id: UUID,
    workspace_id: UUID,
) -> int:
    await remove_source(qdrant, workspace_id, source_id)
    if operation == "delete":
        return 0

    if source_type == "page":
        source = await session.get(Page, source_id)
        if source is None or source.workspace_id != workspace_id:
            return 0
        text = document_json_to_text(source.blocks)
        title = source.title
    else:
        source = await session.get(Document, source_id)
        if source is None or source.workspace_id != workspace_id:
            return 0
        text = source.extracted_text
        title = source.name

    chunks = chunk_text(f"{title}\n{text}")
    for offset, chunk_batch in enumerate(batch(chunks, 64)):
        response = await openai.embeddings.create(
            model=settings.openai_embedding_model,
            input=chunk_batch,
            dimensions=settings.embedding_dimensions,
            encoding_format="float",
        )
        points = [
            models.PointStruct(
                id=point_id(workspace_id, source_id, offset * 64 + item.index),
                vector=item.embedding,
                payload={
                    "workspace_id": str(workspace_id),
                    "source_id": str(source_id),
                    "source_type": source_type,
                    "title": title,
                    "text": chunk_batch[item.index],
                },
            )
            for item in response.data
        ]
        if points:
            await qdrant.upsert(collection_name=settings.qdrant_collection, points=points, wait=True)
    logger.info("Indexed %d chunks for %s %s", len(chunks), source_type, source_id)
    return len(chunks)
