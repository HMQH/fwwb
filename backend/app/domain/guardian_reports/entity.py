from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class GuardianSafetyReport(Base):
    __tablename__ = "guardian_safety_reports"
    __table_args__ = (
        CheckConstraint(
            "report_type = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'custom'::text])",
            name="ck_guardian_safety_reports_report_type",
        ),
        CheckConstraint(
            "overall_risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])",
            name="ck_guardian_safety_reports_overall_risk_level",
        ),
        CheckConstraint(
            "status = ANY (ARRAY['generated'::text, 'sent'::text, 'read'::text, 'archived'::text])",
            name="ck_guardian_safety_reports_status",
        ),
        CheckConstraint(
            "llm_status = ANY (ARRAY['success'::text, 'fallback'::text, 'failed'::text])",
            name="ck_guardian_safety_reports_llm_status",
        ),
        CheckConstraint("overall_risk_score >= 0 AND overall_risk_score <= 100", name="ck_guardian_safety_reports_score"),
        CheckConstraint("period_end > period_start", name="ck_guardian_safety_reports_period"),
        UniqueConstraint(
            "ward_user_id",
            "report_type",
            "period_start",
            "period_end",
            name="uq_guardian_safety_reports_period",
        ),
        Index("idx_guardian_safety_reports_ward_created_at", "ward_user_id", "created_at"),
        Index("idx_guardian_safety_reports_type_period_start", "report_type", "period_start"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    ward_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    creator_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    report_type: Mapped[str] = mapped_column(Text, nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_label: Mapped[str] = mapped_column(Text, nullable=False)
    overall_risk_level: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'low'"))
    overall_risk_score: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    total_submissions: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    total_results: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    high_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    medium_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    low_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'generated'"))
    llm_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'fallback'"))
    payload: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    raw_aggregates: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class GuardianSafetyReportReceipt(Base):
    __tablename__ = "guardian_safety_report_receipts"
    __table_args__ = (
        CheckConstraint(
            "delivery_channel = ANY (ARRAY['inapp'::text, 'push'::text, 'sms'::text, 'manual'::text])",
            name="ck_guardian_safety_report_receipts_channel",
        ),
        CheckConstraint(
            "delivery_status = ANY (ARRAY['pending'::text, 'sent'::text, 'read'::text, 'failed'::text])",
            name="ck_guardian_safety_report_receipts_status",
        ),
        UniqueConstraint(
            "report_id",
            "guardian_binding_id",
            name="uq_guardian_safety_report_receipts_binding",
        ),
        Index("idx_guardian_safety_report_receipts_binding_created_at", "guardian_binding_id", "created_at"),
        Index("idx_guardian_safety_report_receipts_report_id", "report_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardian_safety_reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    guardian_binding_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardian_bindings.id", ondelete="CASCADE"),
        nullable=False,
    )
    guardian_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    guardian_phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_channel: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'inapp'"))
    delivery_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class GuardianSafetyReportAction(Base):
    __tablename__ = "guardian_safety_report_actions"
    __table_args__ = (
        CheckConstraint(
            "action_type = ANY (ARRAY['call'::text, 'message'::text, 'review'::text, 'training'::text, 'checklist'::text, 'monitor'::text])",
            name="ck_guardian_safety_report_actions_type",
        ),
        CheckConstraint(
            "priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])",
            name="ck_guardian_safety_report_actions_priority",
        ),
        CheckConstraint(
            "status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'skipped'::text])",
            name="ck_guardian_safety_report_actions_status",
        ),
        UniqueConstraint("report_id", "action_key", name="uq_guardian_safety_report_actions_key"),
        Index("idx_guardian_safety_report_actions_report_status", "report_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardian_safety_reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    action_key: Mapped[str] = mapped_column(Text, nullable=False)
    action_label: Mapped[str] = mapped_column(Text, nullable=False)
    action_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'review'"))
    priority: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'medium'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    payload: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
