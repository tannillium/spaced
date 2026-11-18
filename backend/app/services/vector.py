from uuid import UUID, uuid5, NAMESPACE_URL

from qdrant_client import AsyncQdrantClient, models

from app.config import settings
from app.schemas import Citation, SearchHit


def point_id(workspace_id: UUID, source_id: UUID, chunk_index: int) -> UUID:
    return uuid5(NAMESPACE_URL, f"spaced:{workspace_id}:{source_id}:{chunk_index}")


async def ensure_collection(client: AsyncQdrantClient) -> None:
    collections = await client.get_collections()
    if not any(item.name == settings.qdrant_collection for item in collections.collections):
        await client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=models.VectorParams(size=settings.embedding_dimensions, distance=models.Distance.COSINE),
        )
    for field in ("workspace_id", "source_id", "source_type"):
        try:
            await client.create_payload_index(
                collection_name=settings.qdrant_collection,
                field_name=field,
                field_schema=models.PayloadSchemaType.KEYWORD,
                wait=True,
            )
        except Exception:
            # Index creation is idempotent; an existing index is expected on restarts.
            pass


async def remove_source(client: AsyncQdrantClient, workspace_id: UUID, source_id: UUID) -> None:
    await client.delete(
        collection_name=settings.qdrant_collection,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(key="workspace_id", match=models.MatchValue(value=str(workspace_id))),
                    models.FieldCondition(key="source_id", match=models.MatchValue(value=str(source_id))),
                ]
            )
        ),
        wait=True,
    )


async def retrieve(
    client: AsyncQdrantClient,
    workspace_id: UUID,
    query_vector: list[float],
    limit: int = 6,
) -> list[Citation]:
    response = await client.query_points(
        collection_name=settings.qdrant_collection,
        query=query_vector,
        query_filter=models.Filter(
            must=[models.FieldCondition(key="workspace_id", match=models.MatchValue(value=str(workspace_id)))]
        ),
        limit=limit,
        with_payload=True,
    )
    citations: list[Citation] = []
    seen: set[tuple[str, str]] = set()
    for hit in response.points:
        payload = hit.payload or {}
        key = (str(payload.get("source_type", "")), str(payload.get("source_id", "")))
        if not key[1] or key in seen:
            continue
        seen.add(key)
        citations.append(
            Citation(
                source_id=UUID(key[1]),
                source_type=key[0],
                title=str(payload.get("title", "Untitled")),
                excerpt=str(payload.get("text", ""))[:1100],
                score=float(hit.score or 0),
            )
        )
    return citations
