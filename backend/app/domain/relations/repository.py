"""关系对象仓储。"""
from __future__ import annotations

import uuid

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.domain.relations.entity import UserRelationMemory, UserRelationProfile, UserRelationUploadLink



def _profile_stmt() -> Select[tuple[UserRelationProfile]]:
    return select(UserRelationProfile)



def _memory_stmt() -> Select[tuple[UserRelationMemory]]:
    return select(UserRelationMemory)



def _link_stmt() -> Select[tuple[UserRelationUploadLink]]:
    return select(UserRelationUploadLink)



def list_profiles_for_user(db: Session, *, user_id: uuid.UUID) -> list[UserRelationProfile]:
    stmt = (
        _profile_stmt()
        .where(UserRelationProfile.user_id == user_id)
        .order_by(UserRelationProfile.updated_at.desc(), UserRelationProfile.created_at.desc())
    )
    return list(db.execute(stmt).scalars().all())



def get_profile_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
) -> UserRelationProfile | None:
    stmt = (
        _profile_stmt()
        .where(UserRelationProfile.user_id == user_id)
        .where(UserRelationProfile.id == relation_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()



def list_profiles_by_ids(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_ids: list[uuid.UUID],
) -> list[UserRelationProfile]:
    if not relation_ids:
        return []
    stmt = (
        _profile_stmt()
        .where(UserRelationProfile.user_id == user_id)
        .where(UserRelationProfile.id.in_(relation_ids))
    )
    return list(db.execute(stmt).scalars().all())



def list_links_for_upload_ids(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_ids: list[uuid.UUID],
) -> list[UserRelationUploadLink]:
    if not upload_ids:
        return []
    stmt = (
        _link_stmt()
        .where(UserRelationUploadLink.user_id == user_id)
        .where(UserRelationUploadLink.user_upload_id.in_(upload_ids))
    )
    return list(db.execute(stmt).scalars().all())



def list_links_for_relation(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
) -> list[UserRelationUploadLink]:
    stmt = (
        _link_stmt()
        .where(UserRelationUploadLink.user_id == user_id)
        .where(UserRelationUploadLink.relation_profile_id == relation_id)
        .order_by(UserRelationUploadLink.created_at.desc())
    )
    return list(db.execute(stmt).scalars().all())



def list_existing_links(
    db: Session,
    *,
    relation_profile_id: uuid.UUID,
    user_upload_id: uuid.UUID,
    file_paths: list[str],
) -> list[UserRelationUploadLink]:
    if not file_paths:
        return []
    stmt = (
        _link_stmt()
        .where(UserRelationUploadLink.relation_profile_id == relation_profile_id)
        .where(UserRelationUploadLink.user_upload_id == user_upload_id)
        .where(UserRelationUploadLink.file_path.in_(file_paths))
    )
    return list(db.execute(stmt).scalars().all())



def list_memories_for_relation(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
) -> list[UserRelationMemory]:
    stmt = (
        _memory_stmt()
        .where(UserRelationMemory.user_id == user_id)
        .where(UserRelationMemory.relation_profile_id == relation_id)
        .order_by(UserRelationMemory.happened_at.desc().nullslast(), UserRelationMemory.created_at.desc())
    )
    return list(db.execute(stmt).scalars().all())



def get_memory_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    memory_id: uuid.UUID,
) -> UserRelationMemory | None:
    stmt = (
        _memory_stmt()
        .where(UserRelationMemory.user_id == user_id)
        .where(UserRelationMemory.relation_profile_id == relation_id)
        .where(UserRelationMemory.id == memory_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()
