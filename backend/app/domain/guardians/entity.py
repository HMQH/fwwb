from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class GuardianBinding(Base):
    __tablename__ = "guardian_bindings"
    __table_args__ = (
        CheckConstraint(
            "relation = ANY (ARRAY['self'::text, 'parent'::text, 'spouse'::text, 'child'::text, 'relative'::text])",
            name="ck_guardian_bindings_relation",
        ),
        CheckConstraint(
            "status = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text, 'rejected'::text])",
            name="ck_guardian_bindings_status",
        ),
        Index("idx_guardian_bindings_ward_updated_at", "ward_user_id", "updated_at"),
        Index("idx_guardian_bindings_guardian_phone", "guardian_phone"),
        Index("idx_guardian_bindings_guardian_user_updated_at", "guardian_user_id", "updated_at"),
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
    guardian_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    guardian_phone: Mapped[str] = mapped_column(Text, nullable=False)
    guardian_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    relation: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    consent_scope: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class GuardianRiskEvent(Base):
    __tablename__ = "guardian_risk_events"
    __table_args__ = (
        CheckConstraint(
            "risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])",
            name="ck_guardian_risk_events_risk_level",
        ),
        CheckConstraint(
            "notify_status = ANY (ARRAY['pending'::text, 'sent'::text, 'read'::text, 'failed'::text])",
            name="ck_guardian_risk_events_notify_status",
        ),
        UniqueConstraint(
            "guardian_binding_id",
            "detection_result_id",
            name="uq_guardian_risk_events_binding_result",
        ),
        Index("idx_guardian_risk_events_ward_created_at", "ward_user_id", "created_at"),
        Index("idx_guardian_risk_events_binding_created_at", "guardian_binding_id", "created_at"),
        Index("idx_guardian_risk_events_submission_id", "submission_id"),
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
    guardian_binding_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardian_bindings.id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )
    detection_result_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_results.id", ondelete="SET NULL"),
        nullable=True,
    )
    risk_level: Mapped[str] = mapped_column(Text, nullable=False)
    fraud_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    notify_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class GuardianIntervention(Base):
    __tablename__ = "guardian_interventions"
    __table_args__ = (
        CheckConstraint(
            "action_type = ANY (ARRAY['call'::text, 'message'::text, 'mark_safe'::text, 'suggest_alarm'::text, 'remote_assist'::text])",
            name="ck_guardian_interventions_action_type",
        ),
        CheckConstraint(
            "status = ANY (ARRAY['completed'::text, 'cancelled'::text])",
            name="ck_guardian_interventions_status",
        ),
        Index("idx_guardian_interventions_event_created_at", "risk_event_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    risk_event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardian_risk_events.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'completed'"))
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
