"""闭环通话干预接口模型。"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


RiskLevel = str


class PhoneRiskLookupRequest(BaseModel):
    phone_number: str
    area_code: str | None = None
    call_started_at: datetime | None = None


class PhoneRiskLookupResponse(BaseModel):
    phone_number: str
    risk_level: RiskLevel
    score: int
    labels: list[str] = Field(default_factory=list)
    suggestion: str
    source: str


class CallSessionStartRequest(BaseModel):
    phone_number: str
    call_direction: str = "incoming"
    risk_level_initial: RiskLevel = "low"
    risk_labels: list[str] = Field(default_factory=list)


class CallSessionStopRequest(BaseModel):
    session_id: uuid.UUID
    risk_level_final: RiskLevel | None = None
    summary: str | None = None
    transcript_full_text: str | None = None
    audio_duration_ms: int | None = None
    audio_file_url: str | None = None
    audio_object_key: str | None = None


class OssPolicyRequest(BaseModel):
    filename: str = "recording.wav"
    content_type: str = "audio/wav"


class OssPolicyResponse(BaseModel):
    host: str
    key: str
    policy: str
    signature: str
    oss_access_key_id: str
    success_action_status: str
    content_type: str
    expire_at: str
    object_url: str


class RiskEvaluateTextRequest(BaseModel):
    session_id: uuid.UUID | None = None
    text: str


class RiskRuleHit(BaseModel):
    rule_code: str
    risk_level: RiskLevel
    message: str


class RiskEvaluateTextResponse(BaseModel):
    risk_level: RiskLevel
    score_delta: int = 0
    hits: list[RiskRuleHit] = Field(default_factory=list)


class CallAsrSegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    seq: int
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = None
    is_final: bool
    created_at: datetime


class CallRiskEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    risk_level: RiskLevel
    matched_rule: str
    message: str
    payload: dict | list | None = None
    created_at: datetime


class CallSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    phone_number: str
    call_direction: str
    risk_level_initial: RiskLevel
    risk_level_final: RiskLevel
    risk_labels: list[str] = Field(default_factory=list)
    recording_status: str
    transcript_status: str
    provider_session_key: str | None = None
    transcript_full_text: str | None = None
    summary: str | None = None
    audio_file_url: str | None = None
    audio_object_key: str | None = None
    audio_duration_ms: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CallSessionDetailResponse(CallSessionResponse):
    segments: list[CallAsrSegmentResponse] = Field(default_factory=list)
    risk_events: list[CallRiskEventResponse] = Field(default_factory=list)
