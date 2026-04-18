"""反诈案例模块 ORM 实体。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, Text, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class FraudCase(Base):
    __tablename__ = "fraud_cases"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    source_case_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_domain: Mapped[str] = mapped_column(Text, nullable=False)
    source_article_title: Mapped[str] = mapped_column(Text, nullable=False)
    source_article_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'article'"))
    fraud_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    target_roles: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    warning_signs: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    prevention_actions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    flow_nodes: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    media_assets: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    detail_blocks: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=sql_text("'[]'::jsonb"))
    source_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'published'"))
    review_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("''"))
    knowledge_source_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sql_text("'{}'::jsonb"))
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


class FraudCaseSyncRun(Base):
    __tablename__ = "fraud_case_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'pending'"))
    discovered_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    inserted_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sql_text("'{}'::jsonb"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
