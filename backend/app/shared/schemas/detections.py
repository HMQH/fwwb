"""?? API schema?"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.guardians import GuardianEventSummaryResponse


class DetectionSubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    relation_profile_id: uuid.UUID | None = None
    relation_profile_name: str | None = None
    relation_profile_type: str | None = None
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
    current_step: str | None = None
    progress_percent: int = 0
    progress_detail: dict[str, Any] | None = None
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
    guardian_event_summary: GuardianEventSummaryResponse | None = None
    content_preview: str | None = None


class DetectionHistoryTrendPointResponse(BaseModel):
    bucket_key: str
    label: str
    high: int = 0
    medium: int = 0
    low: int = 0
    total: int = 0


class DetectionHistoryStatisticsResponse(BaseModel):
    scope: str
    total_records: int = 0
    filtered_total: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    points: list[DetectionHistoryTrendPointResponse] = Field(default_factory=list)


class DetectionSubmissionDetailResponse(DetectionHistoryItemResponse):
    pass


class WebPhishingDetectRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "url": "https://example.com/login",
                "html": None,
                "return_features": False,
            }
        }
    )

    url: str = Field(..., description="待检测网页 URL")
    html: str | None = Field(default=None, description="网页 HTML，可选；不传时走 URL-only 模型")
    return_features: bool = Field(default=False, description="是否返回模型特征值")


class WebPhishingDetectResponse(BaseModel):
    url: str
    mode: str
    model_name: str
    pred_label: int
    is_phishing: bool
    phish_prob: float
    confidence: float
    risk_level: str
    features: dict[str, float] | None = None
