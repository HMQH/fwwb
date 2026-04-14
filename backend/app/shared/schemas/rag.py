"""Schemas for RAG job endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RagBackfillRequest(BaseModel):
    source_ids: list[int] | None = None
    source_id_min: int | None = None
    source_id_max: int | None = None
    data_sources: list[str] | None = None
    force: bool = False
    limit: int | None = None
    run_in_background: bool = True


class RagJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_type: str
    modality: str
    status: str
    filters: dict[str, Any] = Field(default_factory=dict)
    embedding_model: str
    total_count: int
    success_count: int
    fail_count: int
    skipped_count: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime

