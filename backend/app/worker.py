import asyncio
import logging
from uuid import UUID

from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from app.config import settings
from app.db import SessionLocal, engine, initialize_database
from app.services.indexing import index_source
from app.services.jobs import GROUP, INDEX_STREAM
from app.services.vector import ensure_collection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("spaced.worker")
CONSUMER = "spaced-indexer"


async def process_event(fields: dict[str, str], redis: Redis, qdrant: AsyncQdrantClient, openai: AsyncOpenAI) -> None:
    async with SessionLocal() as session:
        await index_source(
            session=session,
            qdrant=qdrant,
            openai=openai,
            operation=fields["operation"],
            source_type=fields["source_type"],
            source_id=UUID(fields["source_id"]),
            workspace_id=UUID(fields["workspace_id"]),
        )


async def run() -> None:
    await initialize_database()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    qdrant = AsyncQdrantClient(url=settings.qdrant_url)
    await redis.ping()
    await ensure_collection(qdrant)
    try:
        await redis.xgroup_create(INDEX_STREAM, GROUP, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            raise
    key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else None
    if not key:
        logger.warning("OPENAI_API_KEY is missing; indexing worker will wait without consuming jobs")
    openai = AsyncOpenAI(api_key=key) if key else None
    try:
        while True:
            if openai is None:
                await asyncio.sleep(15)
                key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else None
                if key:
                    openai = AsyncOpenAI(api_key=key)
                continue
            # First retry work already pending for this worker after a restart.
            messages = await redis.xreadgroup(GROUP, CONSUMER, {INDEX_STREAM: "0"}, count=8)
            if not messages:
                messages = await redis.xreadgroup(GROUP, CONSUMER, {INDEX_STREAM: ">"}, count=8, block=5000)
            for _, entries in messages:
                for message_id, fields in entries:
                    try:
                        await process_event(fields, redis, qdrant, openai)
                        await redis.xack(INDEX_STREAM, GROUP, message_id)
                    except Exception:
                        attempt = int(fields.get("attempt", "0")) + 1
                        logger.exception("Indexing failed on attempt %s for %s", attempt, fields.get("source_id"))
                        if attempt < 5:
                            retry = dict(fields)
                            retry["attempt"] = str(attempt)
                            await redis.xadd(INDEX_STREAM, retry, maxlen=10000, approximate=True)
                        else:
                            await redis.xadd("spaced:index:dead", dict(fields), maxlen=1000, approximate=True)
                        await redis.xack(INDEX_STREAM, GROUP, message_id)
    finally:
        if openai:
            await openai.close()
        await qdrant.close()
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
