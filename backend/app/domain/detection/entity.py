"""检测记录 ORM。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Text, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class DetectionSubmission(Base):
    __tablename__ = "detection_submissions"

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
    relation_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_relation_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    storage_batch_id: Mapped[str] = mapped_column(Text, nullable=False)
    has_text: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_audio: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_image: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    text_paths: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    audio_paths: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    image_paths: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    video_paths: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class DetectionJob(Base):
    __tablename__ = "detection_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'text_rag'"))
    input_modality: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'text'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    current_step: Mapped[str | None] = mapped_column(Text, nullable=True, server_default=sql_text("'queued'"))
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    progress_detail: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    rule_score: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    retrieval_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class DetectionResult(Base):
    __tablename__ = "detection_results"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    risk_level: Mapped[str | None] = mapped_column(Text, nullable=True)
    fraud_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_fraud: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    need_manual_review: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    stage_tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    hit_rules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    rule_hits: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    extracted_entities: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sql_text("'{}'::jsonb"))
    input_highlights: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    retrieved_evidence: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    counter_evidence: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    advice: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    llm_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_detail: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
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
