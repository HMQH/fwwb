"""关系对象相关 ORM。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class UserRelationProfile(Base):
    __tablename__ = "user_relation_profiles"
    __table_args__ = (
        CheckConstraint(
            "relation_type = ANY (ARRAY['family'::text, 'friend'::text, 'classmate'::text, 'stranger'::text, 'colleague'::text])",
            name="ck_user_relation_profiles_relation_type",
        ),
        Index("idx_user_relation_profiles_user_updated_at", "user_id", "updated_at"),
    )

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
    relation_type: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'[]'::jsonb"),
    )
    ai_profile_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_profile_payload: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    ai_profile_dirty: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=sql_text("true"),
    )
    ai_profile_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar_color: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class UserRelationUploadLink(Base):
    __tablename__ = "user_relation_upload_links"
    __table_args__ = (
        UniqueConstraint(
            "relation_profile_id",
            "user_upload_id",
            "file_path",
            name="uq_user_relation_upload_links_relation_upload_path",
        ),
        Index("idx_user_relation_upload_links_relation_created_at", "relation_profile_id", "created_at"),
        Index("idx_user_relation_upload_links_upload_id", "user_upload_id"),
    )

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
    relation_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_relation_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_upload_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_uploads.id", ondelete="CASCADE"),
        nullable=False,
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    source_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class UserRelationMemory(Base):
    __tablename__ = "user_relation_memories"
    __table_args__ = (
        CheckConstraint(
            "memory_scope = ANY (ARRAY['short_term'::text, 'long_term'::text])",
            name="ck_user_relation_memories_memory_scope",
        ),
        CheckConstraint(
            "memory_kind = ANY (ARRAY['upload'::text, 'chat'::text, 'note'::text, 'summary'::text])",
            name="ck_user_relation_memories_memory_kind",
        ),
        Index("idx_user_relation_memories_relation_happened_at", "relation_profile_id", "happened_at"),
        Index("idx_user_relation_memories_relation_created_at", "relation_profile_id", "created_at"),
    )

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
    relation_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_relation_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    memory_scope: Mapped[str] = mapped_column(Text, nullable=False)
    memory_kind: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_payload: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'{}'::jsonb"),
    )
    source_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("detection_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_upload_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("user_uploads.id", ondelete="SET NULL"),
        nullable=True,
    )
    happened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
