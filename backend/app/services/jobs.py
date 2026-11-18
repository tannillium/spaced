from uuid import UUID

INDEX_STREAM = "spaced:index:events"
GROUP = "spaced-indexers"


async def enqueue_index(redis, operation: str, source_type: str, source_id: UUID, workspace_id: UUID) -> None:
    await redis.xadd(
        INDEX_STREAM,
        {
            "operation": operation,
            "source_type": source_type,
            "source_id": str(source_id),
            "workspace_id": str(workspace_id),
            "attempt": "0",
        },
        maxlen=10000,
        approximate=True,
    )
