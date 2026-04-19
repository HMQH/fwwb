from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

GuardianReportType = Literal["day", "month", "year"]
GuardianReportRiskLevel = Literal["low", "medium", "high"]
GuardianReportStatus = Literal["generated", "sent", "read", "archived"]
GuardianReportLlmStatus = Literal["success", "fallback", "failed"]
GuardianReportReceiptChannel = Literal["inapp", "push", "sms", "manual"]
GuardianReportReceiptStatus = Literal["pending", "sent", "read", "failed"]
GuardianReportActionType = Literal["call", "message", "review", "training", "checklist", "monitor"]
GuardianReportActionPriority = Literal["high", "medium", "low"]
GuardianReportActionStatus = Literal["pending", "in_progress", "completed", "skipped"]


class GenerateGuardianReportRequest(BaseModel):
    report_type: GuardianReportType
    ward_user_id: UUID | None = None
    target_date: date | None = None
    force_regenerate: bool = False


class UpdateGuardianReportActionStatusRequest(BaseModel):
    status: GuardianReportActionStatus


class GuardianSafetyReportReceiptResponse(BaseModel):
    id: UUID
    report_id: UUID
    guardian_binding_id: UUID
    guardian_user_id: UUID | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    delivery_channel: GuardianReportReceiptChannel
    delivery_status: GuardianReportReceiptStatus
    sent_at: datetime | None = None
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class GuardianSafetyReportActionResponse(BaseModel):
    id: UUID
    report_id: UUID
    action_key: str
    action_label: str
    action_detail: str | None = None
    action_type: GuardianReportActionType
    priority: GuardianReportActionPriority
    status: GuardianReportActionStatus
    due_at: datetime | None = None
    completed_at: datetime | None = None
    assignee_user_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class GuardianSafetyReportListItemResponse(BaseModel):
    id: UUID
    ward_user_id: UUID
    ward_display_name: str | None = None
    ward_phone: str | None = None
    creator_user_id: UUID | None = None
    report_type: GuardianReportType
    period_start: datetime
    period_end: datetime
    period_label: str
    overall_risk_level: GuardianReportRiskLevel
    overall_risk_score: int
    total_submissions: int
    total_results: int
    high_count: int
    medium_count: int
    low_count: int
    status: GuardianReportStatus
    llm_model: str | None = None
    llm_status: GuardianReportLlmStatus
    llm_title: str | None = None
    llm_summary: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    raw_aggregates: dict[str, Any] = Field(default_factory=dict)
    read_at: datetime | None = None
    sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    is_read: bool = False
    receipts: list[GuardianSafetyReportReceiptResponse] = Field(default_factory=list)
    actions: list[GuardianSafetyReportActionResponse] = Field(default_factory=list)


class GuardianSafetyReportDetailResponse(GuardianSafetyReportListItemResponse):
    pass
