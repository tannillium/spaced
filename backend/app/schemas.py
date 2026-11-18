from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PageCreate(BaseModel):
    title: str = Field(default="Untitled", min_length=1, max_length=500)
    parent_id: UUID | None = None
    icon: str = Field(default="📄", max_length=32)
    favorite: bool = False
    blocks: dict[str, Any] = Field(default_factory=lambda: {"type": "doc", "content": [{"type": "paragraph"}]})


class PageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    parent_id: UUID | None = None
    icon: str | None = Field(default=None, max_length=32)
    favorite: bool | None = None
    blocks: dict[str, Any] | None = None


class PageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    parent_id: UUID | None
    title: str
    icon: str
    favorite: bool
    blocks: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    source_page_id: UUID | None
    name: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    file_url: str = ""
    indexed: bool = False


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    current_page_id: UUID | None = None


class Citation(BaseModel):
    source_id: UUID
    source_type: str
    title: str
    excerpt: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]


class SearchHit(BaseModel):
    source_id: UUID
    source_type: str
    title: str
    excerpt: str
    score: float
