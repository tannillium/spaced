from functools import lru_cache
from pathlib import Path
from uuid import UUID

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://spaced:spaced@localhost:5432/spaced"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "spaced_chunks"
    openai_api_key: SecretStr | None = None
    openai_chat_model: str = "gpt-6.2-sol"
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    default_workspace_id: UUID = UUID("00000000-0000-4000-8000-000000000001")
    upload_dir: Path = Path("/data/uploads")
    max_upload_bytes: int = 25 * 1024 * 1024
    frontend_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
