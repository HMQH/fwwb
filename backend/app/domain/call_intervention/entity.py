"""通话干预相关 ORM。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class CallSession(Base):
    __tablename__ = "call_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    phone_number: Mapped[str] = mapped_column(Text, nullable=False)
    call_direction: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'incoming'"),
    )
    risk_level_initial: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'low'"),
    )
    risk_level_final: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'low'"),
    )
    risk_labels: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'[]'::jsonb"),
    )
    recording_status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'idle'"),
    )
    transcript_status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'pending'"),
    )
    provider_session_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_full_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CallAsrSegment(Base):
    __tablename__ = "call_asr_segments"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("call_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(nullable=True)
    is_final: Mapped[bool] = mapped_column(nullable=False, server_default=sql_text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class CallRiskEvent(Base):
    __tablename__ = "call_risk_events"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("call_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'rule_hit'"),
    )
    risk_level: Mapped[str] = mapped_column(Text, nullable=False)
    matched_rule: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class PhoneRiskProfile(Base):
    __tablename__ = "phone_risk_profiles"

    phone_number: Mapped[str] = mapped_column(Text, primary_key=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    labels: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'[]'::jsonb"),
    )
    source: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sql_text("'system'"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
