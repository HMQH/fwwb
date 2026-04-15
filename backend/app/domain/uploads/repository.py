"""上传记录仓储。"""
from __future__ import annotations

import uuid

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.domain.uploads.entity import UserUpload



def _user_upload_stmt() -> Select[tuple[UserUpload]]:
    return select(UserUpload)



def get_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_id: uuid.UUID,
) -> UserUpload | None:
    stmt = (
        _user_upload_stmt()
        .where(UserUpload.id == upload_id)
        .where(UserUpload.user_id == user_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()



def get_by_batch_type(
    db: Session,
    *,
    user_id: uuid.UUID,
    storage_batch_id: str,
    upload_type: str,
) -> UserUpload | None:
    stmt = (
        _user_upload_stmt()
        .where(UserUpload.user_id == user_id)
        .where(UserUpload.storage_batch_id == storage_batch_id)
        .where(UserUpload.upload_type == upload_type)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()



def list_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[UserUpload]:
    stmt = (
        _user_upload_stmt()
        .where(UserUpload.user_id == user_id)
        .order_by(UserUpload.created_at.desc(), UserUpload.updated_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())



def list_by_ids_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_ids: list[uuid.UUID],
) -> list[UserUpload]:
    if not upload_ids:
        return []
    stmt = (
        _user_upload_stmt()
        .where(UserUpload.user_id == user_id)
        .where(UserUpload.id.in_(upload_ids))
    )
    return list(db.execute(stmt).scalars().all())
