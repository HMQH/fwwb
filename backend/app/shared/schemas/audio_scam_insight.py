from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ScamBehaviorProfile(BaseModel):
    urgency_score: float = 0.0
    dominance_score: float = 0.0
    command_score: float = 0.0
    victim_compliance_score: float = 0.0
    speech_pressure_score: float = 0.0
    summary: str = ""


class ScamModalityContribution(BaseModel):
    audio_behavior: float = 0.0
    semantic_content: float = 0.0
    process_dynamics: float = 0.0


class ScamStageSlice(BaseModel):
    id: str
    stage: str
    label: str
    start_sec: float
    end_sec: float
    color: str = "#DCEBFF"
    risk_score: float = 0.0
    summary: str = ""
    cue_tags: list[str] = Field(default_factory=list)


class ScamRiskCurvePoint(BaseModel):
    time_sec: float
    risk_score: float


class ScamKeyMoment(BaseModel):
    id: str
    label: str
    time_sec: float
    stage_label: str
    description: str = ""
    user_meaning: str = ""
    tone: str = "warning"


class ScamDynamics(BaseModel):
    total_duration_sec: float = 0.0
    earliest_risk_sec: float = 0.0
    escalation_sec: float = 0.0
    peak_risk_sec: float = 0.0
    stage_sequence: list[ScamStageSlice] = Field(default_factory=list)
    risk_curve: list[ScamRiskCurvePoint] = Field(default_factory=list)
    key_moments: list[ScamKeyMoment] = Field(default_factory=list)


class ScamEvidenceSegment(BaseModel):
    id: str
    start_sec: float
    end_sec: float
    stage: str
    stage_label: str
    risk_score: float = 0.0
    transcript_excerpt: str = ""
    audio_tags: list[str] = Field(default_factory=list)
    semantic_tags: list[str] = Field(default_factory=list)
    explanation: str = ""


class ScamDecision(BaseModel):
    call_risk_score: float = 0.0
    risk_level: str = "low"
    confidence: float = 0.0
    summary: str = ""
    explanation: str = ""
    suggested_actions: list[str] = Field(default_factory=list)


class AudioScamInsightResponse(BaseModel):
    behavior_profile: ScamBehaviorProfile
    dynamics: ScamDynamics
    evidence_segments: list[ScamEvidenceSegment] = Field(default_factory=list)
    decision: ScamDecision
    modality_contrib: ScamModalityContribution


class AudioScamInsightUploadRequest(BaseModel):
    audio_path: str
    filename: str | None = None
    language_hint: str = "zh"


class AudioScamInsightJobSubmitResponse(BaseModel):
    job_id: uuid.UUID
    status: str
    created_at: datetime
    filename: str | None = None


class AudioScamInsightJobResponse(BaseModel):
    job_id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    filename: str | None = None
    error_message: str | None = None
    result: AudioScamInsightResponse | None = None
