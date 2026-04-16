"""上传记录 ORM。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, func, text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.shared.db.base import Base


class UserUpload(Base):
    __tablename__ = "user_uploads"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "storage_batch_id",
            "upload_type",
            name="uq_user_uploads_user_batch_type",
        ),
        CheckConstraint(
            "upload_type = ANY (ARRAY['text'::text, 'audio'::text, 'image'::text, 'video'::text])",
            name="ck_user_uploads_upload_type",
        ),
        Index("idx_user_uploads_user_created_at", "user_id", "created_at"),
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
    storage_batch_id: Mapped[str] = mapped_column(Text, nullable=False)
    upload_type: Mapped[str] = mapped_column(Text, nullable=False)
    file_paths: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sql_text("'[]'::jsonb"),
    )
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
