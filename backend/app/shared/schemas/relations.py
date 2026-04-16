"""关系对象接口 schema。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RelationType = Literal["family", "friend", "classmate", "stranger", "colleague"]
MemoryScope = Literal["short_term", "long_term"]
MemoryKind = Literal["upload", "chat", "note", "summary"]


class RelationProfileCreateRequest(BaseModel):
    relation_type: RelationType
    name: str = Field(..., min_length=1, max_length=24)
    description: str | None = Field(default=None, max_length=120)
    tags: list[str] = Field(default_factory=list)


class RelationProfileUpdateRequest(BaseModel):
    relation_type: RelationType | None = None
    name: str | None = Field(default=None, min_length=1, max_length=24)
    description: str | None = Field(default=None, max_length=120)
    tags: list[str] | None = None


class RelationProfileSummaryResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    relation_type: RelationType | str
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    avatar_color: str | None = None
    avatar_url: str | None = None
    short_term_count: int = 0
    long_term_count: int = 0
    linked_upload_count: int = 0
    bound_file_count: int = 0
    created_at: datetime
    updated_at: datetime


class RelationMemoryResponse(BaseModel):
    id: uuid.UUID
    relation_profile_id: uuid.UUID
    memory_scope: MemoryScope | str
    memory_kind: MemoryKind | str
    title: str
    content: str
    extra_payload: dict[str, Any] = Field(default_factory=dict)
    source_submission_id: uuid.UUID | None = None
    source_upload_id: uuid.UUID | None = None
    happened_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RelationLinkedUploadResponse(BaseModel):
    user_upload_id: uuid.UUID
    upload_type: str
    storage_batch_id: str
    file_paths: list[str] = Field(default_factory=list)
    file_count: int = 0
    source_submission_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class RelationDetailResponse(BaseModel):
    profile: RelationProfileSummaryResponse
    short_term_memories: list[RelationMemoryResponse] = Field(default_factory=list)
    long_term_memories: list[RelationMemoryResponse] = Field(default_factory=list)
    linked_uploads: list[RelationLinkedUploadResponse] = Field(default_factory=list)


class RelationMemoryCreateRequest(BaseModel):
    memory_scope: MemoryScope = "short_term"
    memory_kind: MemoryKind = "note"
    title: str = Field(..., min_length=1, max_length=28)
    content: str = Field(..., min_length=1, max_length=240)


class RelationMemoryUpdateRequest(BaseModel):
    memory_scope: MemoryScope
