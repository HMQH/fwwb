"""ORM models for RAG ingestion state."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Integer, Text, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class RagIngestJob(Base):
    __tablename__ = "rag_ingest_jobs"
    __table_args__ = (
        CheckConstraint("modality IN ('text')", name="rag_ingest_jobs_modality_check"),
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name="rag_ingest_jobs_status_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    job_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'backfill'"))
    modality: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'text'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sql_text("'{}'::jsonb"))
    embedding_model: Mapped[str] = mapped_column(Text, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    fail_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class RagSourceSyncState(Base):
    __tablename__ = "rag_source_sync_state"
    __table_args__ = (
        CheckConstraint("modality IN ('text')", name="rag_source_sync_state_modality_check"),
        CheckConstraint(
            "status IN ('completed', 'failed', 'empty')",
            name="rag_source_sync_state_status_check",
        ),
        CheckConstraint("chunk_count >= 0", name="rag_source_sync_state_chunk_count_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    modality: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'text'"))
    embedding_model: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
