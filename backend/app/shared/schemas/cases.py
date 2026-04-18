"""反诈案例模块 Schema。"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FraudCaseFlowNodeResponse(BaseModel):
    id: str
    label: str
    tone: str | None = None


class FraudCaseMediaAssetResponse(BaseModel):
    type: str
    url: str
    thumbnail_url: str | None = None


class FraudCaseDetailBlockResponse(BaseModel):
    title: str
    paragraphs: list[str] = Field(default_factory=list)


class FraudCaseCategoryResponse(BaseModel):
    key: str
    label: str
    count: int


class FraudCaseSyncRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_name: str
    status: str
    discovered_count: int
    inserted_count: int
    updated_count: int
    skipped_count: int
    error_message: str | None = None
    detail: dict = Field(default_factory=dict)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class FraudCaseListItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_name: str
    source_domain: str
    source_article_title: str
    source_article_url: str
    title: str
    summary: str | None = None
    content_type: str
    fraud_type: str | None = None
    topic_key: str
    topic_label: str
    cover_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    target_roles: list[str] = Field(default_factory=list)
    warning_signs: list[str] = Field(default_factory=list)
    prevention_actions: list[str] = Field(default_factory=list)
    flow_nodes: list[FraudCaseFlowNodeResponse] = Field(default_factory=list)
    media_assets: list[FraudCaseMediaAssetResponse] = Field(default_factory=list)
    detail_blocks: list[FraudCaseDetailBlockResponse] = Field(default_factory=list)
    source_published_at: datetime | None = None
    published_at: datetime
    last_synced_at: datetime
    is_featured: bool
    status: str
    created_at: datetime
    updated_at: datetime


class FraudCaseDetailResponse(FraudCaseListItemResponse):
    related_cases: list[FraudCaseListItemResponse] = Field(default_factory=list)


class FraudCaseListResponse(BaseModel):
    items: list[FraudCaseListItemResponse] = Field(default_factory=list)
    page: int
    limit: int
    total: int
    has_more: bool
    categories: list[FraudCaseCategoryResponse] = Field(default_factory=list)
    last_sync_at: datetime | None = None
    latest_sync: FraudCaseSyncRunResponse | None = None


class FraudCaseSyncResponse(BaseModel):
    sync_run: FraudCaseSyncRunResponse
    discovered_count: int
    inserted_count: int
    updated_count: int
    skipped_count: int
