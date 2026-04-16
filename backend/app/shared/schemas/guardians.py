from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

_PHONE_RE = re.compile(r"^1\d{10}$")

GuardianBindingRelation = Literal["self", "parent", "spouse", "child", "relative"]
GuardianBindingStatus = Literal["pending", "active", "revoked", "rejected"]
GuardianEventNotifyStatus = Literal["pending", "sent", "read", "failed"]
GuardianOwnership = Literal["ward", "guardian", "self", "viewer"]
GuardianActionType = Literal["call", "message", "mark_safe", "suggest_alarm", "remote_assist"]


class CreateGuardianBindingRequest(BaseModel):
    guardian_phone: str = Field(..., min_length=11, max_length=11)
    guardian_name: str | None = Field(default=None, max_length=32)
    relation: GuardianBindingRelation
    consent_scope: dict[str, Any] | None = None
    is_primary: bool = True

    @field_validator("guardian_phone")
    @classmethod
    def phone_cn(cls, value: str) -> str:
        normalized = value.strip()
        if not _PHONE_RE.match(normalized):
            raise ValueError("手机号格式无效")
        return normalized


class GuardianBindingResponse(BaseModel):
    id: UUID
    ward_user_id: UUID
    guardian_user_id: UUID | None = None
    ward_display_name: str | None = None
    ward_phone: str | None = None
    guardian_display_name: str | None = None
    guardian_phone: str
    guardian_name: str | None = None
    relation: GuardianBindingRelation
    status: GuardianBindingStatus
    is_primary: bool
    consent_scope: dict[str, Any] = Field(default_factory=dict)
    verified_at: datetime | None = None
    ownership: GuardianOwnership
    created_at: datetime
    updated_at: datetime


class GuardianInterventionResponse(BaseModel):
    id: UUID
    risk_event_id: UUID
    actor_user_id: UUID | None = None
    actor_display_name: str | None = None
    action_type: GuardianActionType
    status: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class GuardianEventSummaryResponse(BaseModel):
    event_count: int
    latest_event_id: UUID
    latest_risk_level: str
    latest_notify_status: GuardianEventNotifyStatus
    latest_guardian_name: str | None = None
    latest_guardian_phone: str | None = None
    latest_guardian_relation: GuardianBindingRelation | None = None
    latest_created_at: datetime
    latest_acknowledged_at: datetime | None = None


class GuardianEventResponse(BaseModel):
    id: UUID
    ward_user_id: UUID
    ward_display_name: str | None = None
    ward_phone: str | None = None
    guardian_binding_id: UUID
    guardian_name: str | None = None
    guardian_phone: str
    guardian_relation: GuardianBindingRelation
    binding_status: GuardianBindingStatus
    ownership: GuardianOwnership
    submission_id: UUID | None = None
    detection_result_id: UUID | None = None
    risk_level: str
    fraud_type: str | None = None
    summary: str
    evidence_json: dict[str, Any] = Field(default_factory=dict)
    notify_status: GuardianEventNotifyStatus
    notified_at: datetime | None = None
    acknowledged_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    interventions: list[GuardianInterventionResponse] = Field(default_factory=list)


class CreateGuardianEventsRequest(BaseModel):
    submission_id: UUID


class CreateGuardianInterventionRequest(BaseModel):
    action_type: GuardianActionType
    note: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any] | None = None
