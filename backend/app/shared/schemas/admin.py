"""管理员端接口 Schema。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CaseReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=1000)


class CaseBatchApproveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class CaseSyncRequest(BaseModel):
    urls: list[str] | None = Field(default=None, max_length=50)


class SourceImportTextRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    sample_label: Literal["black", "white"] = "white"
    fraud_type: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=1000)
    data_source: str | None = Field(default=None, max_length=120)


class AdminDashboardResponse(BaseModel):
    stats: dict[str, int]
    latest_case_sync: dict[str, Any] | None = None
    official_sources: list[str] = Field(default_factory=list)
    seed_urls: list[str] = Field(default_factory=list)
    pending_cases: list[dict[str, Any]] = Field(default_factory=list)


class AdminCaseListResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


class AdminSourceListResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


class AdminFeedbackListResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


class DetectionFeedbackCreateRequest(BaseModel):
    user_label: Literal["unknown", "fraud", "safe"] = "unknown"
    reviewed_fraud_type: str | None = Field(default=None, max_length=120)
    helpful: bool | None = None
    note: str | None = Field(default=None, max_length=1000)


class DetectionFeedbackResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    submission_id: uuid.UUID
    job_id: uuid.UUID | None = None
    result_id: uuid.UUID | None = None
    user_label: str
    reviewed_fraud_type: str | None = None
    helpful: bool | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime
