"""Relation and memory service."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.relations import repository as relation_repository
from app.domain.relations.entity import UserRelationMemory, UserRelationProfile, UserRelationUploadLink
from app.domain.uploads import repository as upload_repository
from app.domain.uploads.entity import UserUpload
from app.shared.storage.upload_paths import resolved_upload_root, safe_suffix, save_relation_avatar_bytes

_RELATION_COLORS = {
    "family": "#5A8CFF",
    "friend": "#43A5F5",
    "classmate": "#6A74FF",
    "stranger": "#9A7BFF",
    "colleague": "#4E9BD6",
}

_RELATION_TYPE_SET = {"family", "friend", "classmate", "stranger", "colleague"}
_MEMORY_SCOPE_SET = {"short_term", "long_term"}
_MEMORY_KIND_SET = {"upload", "chat", "note", "summary"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: str | None, *, fallback: str | None = None, max_length: int | None = None) -> str | None:
    if value is None:
        return fallback
    cleaned = value.strip()
    if not cleaned:
        return fallback
    if max_length is not None:
        cleaned = cleaned[:max_length].strip()
    return cleaned or fallback


def _clean_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in tags:
        cleaned = _clean_text(item, max_length=16)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result[:6]


def _validate_relation_type(relation_type: str) -> str:
    cleaned = _clean_text(relation_type, fallback="") or ""
    if cleaned not in _RELATION_TYPE_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="关系类型无效")
    return cleaned


def _validate_memory_scope(memory_scope: str) -> str:
    cleaned = _clean_text(memory_scope, fallback="") or ""
    if cleaned not in _MEMORY_SCOPE_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="记忆层级无效")
    return cleaned


def _validate_memory_kind(memory_kind: str) -> str:
    cleaned = _clean_text(memory_kind, fallback="") or ""
    if cleaned not in _MEMORY_KIND_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="记忆类型无效")
    return cleaned


def _memory_snapshot(memory: UserRelationMemory) -> dict[str, Any]:
    return {
        "id": memory.id,
        "relation_profile_id": memory.relation_profile_id,
        "memory_scope": memory.memory_scope,
        "memory_kind": memory.memory_kind,
        "title": memory.title,
        "content": memory.content,
        "extra_payload": dict(memory.extra_payload or {}),
        "source_submission_id": memory.source_submission_id,
        "source_upload_id": memory.source_upload_id,
        "happened_at": memory.happened_at,
        "created_at": memory.created_at,
        "updated_at": memory.updated_at,
    }


def _build_profile_summary(
    profile: UserRelationProfile,
    *,
    memories: list[UserRelationMemory],
    links_count: int,
    file_count: int,
) -> dict[str, Any]:
    short_term_count = sum(1 for item in memories if item.memory_scope == "short_term")
    long_term_count = sum(1 for item in memories if item.memory_scope == "long_term")
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "relation_type": profile.relation_type,
        "name": profile.name,
        "description": profile.description,
        "tags": list(profile.tags or []),
        "avatar_color": profile.avatar_color,
        "avatar_url": profile.avatar_url,
        "short_term_count": short_term_count,
        "long_term_count": long_term_count,
        "linked_upload_count": links_count,
        "bound_file_count": file_count,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    }


def _upload_memory_title(upload_type: str, count: int) -> str:
    label = {"text": "文本", "audio": "音频", "image": "图片", "video": "视频"}.get(upload_type, "素材")
    return f"{label} × {count}"


def _upload_memory_content(paths: list[str]) -> str:
    names = [Path(path).name for path in paths if path]
    if not names:
        return "已归档"
    preview = "、".join(names[:3])
    if len(names) <= 3:
        return preview
    return f"{preview} 等 {len(names)} 项"


def list_profiles(
    db: Session,
    *,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    profiles = relation_repository.list_profiles_for_user(db, user_id=user_id)
    items: list[dict[str, Any]] = []
    for profile in profiles:
        memories = relation_repository.list_memories_for_relation(
            db,
            user_id=user_id,
            relation_id=profile.id,
        )
        links = relation_repository.list_links_for_relation(
            db,
            user_id=user_id,
            relation_id=profile.id,
        )
        items.append(
            _build_profile_summary(
                profile,
                memories=memories,
                links_count=len({item.user_upload_id for item in links}),
                file_count=len({item.file_path for item in links}),
            )
        )
    return items


def create_profile(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_type: str,
    name: str,
    description: str | None,
    tags: list[str] | None,
) -> dict[str, Any]:
    cleaned_name = _clean_text(name, max_length=24)
    if not cleaned_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入名字")

    normalized_type = _validate_relation_type(relation_type)
    row = UserRelationProfile(
        user_id=user_id,
        relation_type=normalized_type,
        name=cleaned_name,
        description=_clean_text(description, max_length=120),
        tags=_clean_tags(tags),
        avatar_color=_RELATION_COLORS.get(normalized_type, "#5A8CFF"),
        avatar_url=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _build_profile_summary(row, memories=[], links_count=0, file_count=0)


def update_profile(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    relation_type: str | None,
    name: str | None,
    description: str | None,
    tags: list[str] | None,
) -> dict[str, Any]:
    profile = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    if relation_type is not None:
        profile.relation_type = _validate_relation_type(relation_type)
        profile.avatar_color = _RELATION_COLORS.get(profile.relation_type, profile.avatar_color)
    if name is not None:
        cleaned_name = _clean_text(name, max_length=24)
        if not cleaned_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入名字")
        profile.name = cleaned_name
    if description is not None:
        profile.description = _clean_text(description, max_length=120)
    if tags is not None:
        profile.tags = _clean_tags(tags)

    db.add(profile)
    db.commit()
    db.refresh(profile)

    memories = relation_repository.list_memories_for_relation(db, user_id=user_id, relation_id=profile.id)
    links = relation_repository.list_links_for_relation(db, user_id=user_id, relation_id=profile.id)
    return _build_profile_summary(
        profile,
        memories=memories,
        links_count=len({item.user_upload_id for item in links}),
        file_count=len({item.file_path for item in links}),
    )


def update_avatar(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    avatar_upload: tuple[bytes, str],
    upload_root_cfg: str,
) -> dict[str, Any]:
    profile = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    avatar_bytes, avatar_name = avatar_upload
    upload_root = resolved_upload_root(upload_root_cfg)
    upload_root.mkdir(parents=True, exist_ok=True)
    profile.avatar_url = save_relation_avatar_bytes(
        upload_root=upload_root,
        user_id=user_id,
        relation_id=profile.id,
        data=avatar_bytes,
        suffix=safe_suffix(avatar_name, ".png"),
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    memories = relation_repository.list_memories_for_relation(db, user_id=user_id, relation_id=profile.id)
    links = relation_repository.list_links_for_relation(db, user_id=user_id, relation_id=profile.id)
    return _build_profile_summary(
        profile,
        memories=memories,
        links_count=len({item.user_upload_id for item in links}),
        file_count=len({item.file_path for item in links}),
    )


def get_profile_detail(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
) -> dict[str, Any]:
    profile = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    memories = relation_repository.list_memories_for_relation(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    links = relation_repository.list_links_for_relation(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )

    upload_ids = list({item.user_upload_id for item in links})
    uploads = upload_repository.list_by_ids_for_user(db, user_id=user_id, upload_ids=upload_ids)
    upload_map = {item.id: item for item in uploads}

    grouped_uploads: dict[uuid.UUID, list[str]] = {}
    for link in links:
        grouped_uploads.setdefault(link.user_upload_id, []).append(link.file_path)

    linked_uploads: list[dict[str, Any]] = []
    for upload_id, file_paths in grouped_uploads.items():
        upload = upload_map.get(upload_id)
        if upload is None:
            continue
        linked_uploads.append(
            {
                "user_upload_id": upload.id,
                "upload_type": upload.upload_type,
                "storage_batch_id": upload.storage_batch_id,
                "file_paths": file_paths,
                "file_count": len(file_paths),
                "source_submission_id": upload.source_submission_id,
                "created_at": upload.created_at,
                "updated_at": upload.updated_at,
            }
        )
    linked_uploads.sort(key=lambda item: item["created_at"], reverse=True)

    short_term_memories = [_memory_snapshot(item) for item in memories if item.memory_scope == "short_term"]
    long_term_memories = [_memory_snapshot(item) for item in memories if item.memory_scope == "long_term"]

    return {
        "profile": _build_profile_summary(
            profile,
            memories=memories,
            links_count=len(grouped_uploads),
            file_count=len({item.file_path for item in links}),
        ),
        "short_term_memories": short_term_memories,
        "long_term_memories": long_term_memories,
        "linked_uploads": linked_uploads,
    }


def create_memory(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    memory_scope: str,
    memory_kind: str,
    title: str,
    content: str,
) -> dict[str, Any]:
    relation = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    cleaned_title = _clean_text(title, max_length=28)
    cleaned_content = _clean_text(content, max_length=240)
    if not cleaned_title or not cleaned_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入记忆内容")

    row = UserRelationMemory(
        user_id=user_id,
        relation_profile_id=relation.id,
        memory_scope=_validate_memory_scope(memory_scope),
        memory_kind=_validate_memory_kind(memory_kind),
        title=cleaned_title,
        content=cleaned_content,
        happened_at=_utcnow(),
        extra_payload={},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _memory_snapshot(row)


def update_memory_scope(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    memory_id: uuid.UUID,
    memory_scope: str,
) -> dict[str, Any]:
    memory = relation_repository.get_memory_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
        memory_id=memory_id,
    )
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记忆不存在")
    memory.memory_scope = _validate_memory_scope(memory_scope)
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return _memory_snapshot(memory)


def attach_submission_context(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID | None,
    submission_id: uuid.UUID,
    text_content: str | None,
    upload_rows: list[UserUpload],
) -> None:
    if relation_id is None:
        return

    relation = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    changed = False
    for upload in upload_rows:
        existing = relation_repository.list_existing_links(
            db,
            relation_profile_id=relation.id,
            user_upload_id=upload.id,
            file_paths=list(upload.file_paths or []),
        )
        existing_set = {item.file_path for item in existing}
        new_paths = [path for path in (upload.file_paths or []) if path not in existing_set]
        if not new_paths:
            continue
        for path in new_paths:
            db.add(
                UserRelationUploadLink(
                    user_id=user_id,
                    relation_profile_id=relation.id,
                    user_upload_id=upload.id,
                    file_path=path,
                    source_submission_id=submission_id,
                )
            )
        db.add(
            UserRelationMemory(
                user_id=user_id,
                relation_profile_id=relation.id,
                memory_scope="short_term",
                memory_kind="upload",
                title=_upload_memory_title(upload.upload_type, len(new_paths)),
                content=_upload_memory_content(new_paths),
                extra_payload={
                    "upload_id": str(upload.id),
                    "upload_type": upload.upload_type,
                    "storage_batch_id": upload.storage_batch_id,
                    "file_count": len(new_paths),
                    "file_paths": new_paths,
                },
                source_submission_id=submission_id,
                source_upload_id=upload.id,
                happened_at=_utcnow(),
            )
        )
        changed = True

    preview = _clean_text(text_content, max_length=240)
    existing_chat_memory = False
    if preview:
        existing_chat_memory = any(
            item.memory_kind == "chat" and item.source_submission_id == submission_id
            for item in relation_repository.list_memories_for_relation(
                db,
                user_id=user_id,
                relation_id=relation.id,
            )
        )

    if preview and not existing_chat_memory:
        db.add(
            UserRelationMemory(
                user_id=user_id,
                relation_profile_id=relation.id,
                memory_scope="short_term",
                memory_kind="chat",
                title="聊天记录",
                content=preview,
                extra_payload={"source": "submission"},
                source_submission_id=submission_id,
                happened_at=_utcnow(),
            )
        )
        changed = True

    if changed:
        db.commit()
