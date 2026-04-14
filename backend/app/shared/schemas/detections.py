"""检测 API schema。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DetectionSubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    storage_batch_id: str
    has_text: bool
    has_audio: bool
    has_image: bool
    has_video: bool
    text_paths: list[str] = Field(default_factory=list)
    audio_paths: list[str] = Field(default_factory=list)
    image_paths: list[str] = Field(default_factory=list)
    video_paths: list[str] = Field(default_factory=list)
    text_content: str | None = None
    created_at: datetime
    updated_at: datetime


class DetectionRuleHitResponse(BaseModel):
    name: str
    category: str
    risk_points: int
    explanation: str
    matched_texts: list[str] = Field(default_factory=list)
    stage_tag: str | None = None
    fraud_type_hint: str | None = None


class DetectionEvidenceResponse(BaseModel):
    source_id: int
    chunk_index: int
    sample_label: str
    fraud_type: str | None = None
    data_source: str | None = None
    url: str | None = None
    chunk_text: str
    similarity_score: float
    match_source: str
    reason: str


class DetectionResultResponse(BaseModel):
    id: uuid.UUID
    submission_id: uuid.UUID
    job_id: uuid.UUID | None = None
    risk_level: str | None = None
    fraud_type: str | None = None
    confidence: float | None = None
    is_fraud: bool | None = None
    summary: str | None = None
    final_reason: str | None = None
    need_manual_review: bool = False
    stage_tags: list[str] = Field(default_factory=list)
    hit_rules: list[str] = Field(default_factory=list)
    rule_hits: list[DetectionRuleHitResponse] = Field(default_factory=list)
    extracted_entities: dict[str, Any] = Field(default_factory=dict)
    input_highlights: list[dict[str, str]] = Field(default_factory=list)
    retrieved_evidence: list[DetectionEvidenceResponse] = Field(default_factory=list)
    counter_evidence: list[DetectionEvidenceResponse] = Field(default_factory=list)
    advice: list[str] = Field(default_factory=list)
    llm_model: str | None = None
    result_detail: dict[str, Any] | list[Any] | None = None
    created_at: datetime
    updated_at: datetime


class DetectionJobResponse(BaseModel):
    id: uuid.UUID
    submission_id: uuid.UUID
    job_type: str
    input_modality: str
    status: str
    rule_score: int = 0
    retrieval_query: str | None = None
    llm_model: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    result: DetectionResultResponse | None = None


class DetectionSubmitAcceptedResponse(BaseModel):
    submission: DetectionSubmissionResponse
    job: DetectionJobResponse


class DetectionHistoryItemResponse(BaseModel):
    submission: DetectionSubmissionResponse
    latest_job: DetectionJobResponse | None = None
    latest_result: DetectionResultResponse | None = None
    content_preview: str | None = None


class DetectionSubmissionDetailResponse(DetectionHistoryItemResponse):
    pass
