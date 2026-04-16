"""用户 MEMORY 文档响应模型。"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ProfileMemorySnapshotResponse(BaseModel):
    source: str | None = None
    event_id: str | None = None
    event_title: str | None = None
    created_at: str | None = None
    relation_name: str | None = None
    candidate_memory: str | None = None
    memory_bucket: str | None = None
    query_tags: list[str] = Field(default_factory=list)
    should_promote: bool | None = None
    score_hit: bool | None = None
    promoted_now: bool | None = None
    promoted: bool | None = None
    threshold_hit: bool | None = None
    urgency_delta: int | None = None
    urgency_score_before: int | None = None
    urgency_score_after: int | None = None
    safety_score: int | None = None
    promotion_reason: str | None = None
    merge_reason: str | None = None
    merged_profile_summary: str | None = None
    promotion_score: float | None = None
    memory_path: str | None = None
    daily_note_path: str | None = None


class ProfileMemoryHistoryItemResponse(BaseModel):
    id: UUID
    source: str
    created_at: datetime
    risk_level: str | None = None
    fraud_type: str | None = None
    summary: str | None = None
    snapshot: ProfileMemorySnapshotResponse | None = None


class ProfileMemoryDocumentResponse(BaseModel):
    path: str
    updated_at: datetime | None = None
    markdown: str
    history: list[ProfileMemoryHistoryItemResponse] = Field(default_factory=list)
