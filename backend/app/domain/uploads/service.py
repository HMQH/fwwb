"""Upload service."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.relations import repository as relation_repository
from app.domain.relations.entity import UserRelationMemory, UserRelationUploadLink
from app.domain.uploads import repository as upload_repository
from app.domain.uploads.entity import UserUpload

_UPLOAD_LABELS = {
    "text": "文本",
    "audio": "音频",
    "image": "图片",
    "video": "视频",
}

_VALID_MEMORY_SCOPES = {"short_term", "long_term"}


def _upload_title(upload_type: str, count: int) -> str:
    return f"{_UPLOAD_LABELS.get(upload_type, '文件')} × {count}"


def _upload_content(paths: list[str]) -> str:
    names = [Path(path).name for path in paths if path]
    if not names:
        return "已归档"
    preview = "、".join(names[:3])
    if len(names) <= 3:
        return preview
    return f"{preview} 等 {len(names)} 项"


def _validate_memory_scope(memory_scope: str) -> str:
    normalized = (memory_scope or "").strip()
    if normalized not in _VALID_MEMORY_SCOPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="记忆层级无效")
    return normalized


def _build_relation_binding_payload(
    *,
    uploads: list[UserUpload],
    user_id: uuid.UUID,
    db: Session,
) -> tuple[
    dict[uuid.UUID, list[dict[str, Any]]],
    dict[uuid.UUID, list[dict[str, Any]]],
    dict[uuid.UUID, int],
]:
    upload_ids = [item.id for item in uploads]
    if not upload_ids:
        return {}, {}, {}

    links = relation_repository.list_links_for_upload_ids(
        db,
        user_id=user_id,
        upload_ids=upload_ids,
    )
    relation_ids = list({item.relation_profile_id for item in links})
    relation_map = {
        profile.id: profile
        for profile in relation_repository.list_profiles_by_ids(
            db,
            user_id=user_id,
            relation_ids=relation_ids,
        )
    }

    grouped_by_relation: dict[uuid.UUID, dict[uuid.UUID, set[str]]] = {}
    grouped_by_file: dict[uuid.UUID, dict[str, list[dict[str, Any]]]] = {}
    for link in links:
        profile = relation_map.get(link.relation_profile_id)
        if profile is None:
            continue

        grouped_by_relation.setdefault(link.user_upload_id, {}).setdefault(link.relation_profile_id, set()).add(link.file_path)
        grouped_by_file.setdefault(link.user_upload_id, {}).setdefault(link.file_path, []).append(
            {
                "relation_profile_id": profile.id,
                "relation_name": profile.name,
                "relation_type": profile.relation_type,
            }
        )

    relation_bindings: dict[uuid.UUID, list[dict[str, Any]]] = {}
    file_items: dict[uuid.UUID, list[dict[str, Any]]] = {}
    assigned_counts: dict[uuid.UUID, int] = {}

    for upload in uploads:
        relation_files = grouped_by_relation.get(upload.id, {})
        assigned_paths = {path for paths in relation_files.values() for path in paths}
        assigned_counts[upload.id] = len(assigned_paths)

        binding_entries: list[dict[str, Any]] = []
        for relation_id, paths in relation_files.items():
            profile = relation_map.get(relation_id)
            if profile is None:
                continue
            binding_entries.append(
                {
                    "relation_profile_id": relation_id,
                    "relation_name": profile.name,
                    "relation_type": profile.relation_type,
                    "file_count": len(paths),
                }
            )
        binding_entries.sort(key=lambda item: (item["relation_name"], item["relation_type"]))
        relation_bindings[upload.id] = binding_entries

        upload_file_entries: list[dict[str, Any]] = []
        file_binding_map = grouped_by_file.get(upload.id, {})
        for file_path in list(upload.file_paths or []):
            relations = sorted(
                file_binding_map.get(file_path, []),
                key=lambda item: (item["relation_name"], item["relation_type"]),
            )
            upload_file_entries.append(
                {
                    "file_path": file_path,
                    "assigned": bool(relations),
                    "relations": relations,
                }
            )
        file_items[upload.id] = upload_file_entries

    return relation_bindings, file_items, assigned_counts


def _build_upload_item(
    *,
    upload: UserUpload,
    relation_bindings: list[dict[str, Any]] | None = None,
    files: list[dict[str, Any]] | None = None,
    assigned_file_count: int = 0,
) -> dict[str, Any]:
    relation_bindings = relation_bindings or []
    files = files or []
    file_paths = list(upload.file_paths or [])
    return {
        "id": upload.id,
        "user_id": upload.user_id,
        "storage_batch_id": upload.storage_batch_id,
        "upload_type": upload.upload_type,
        "file_paths": file_paths,
        "files": files,
        "file_count": len(file_paths),
        "source_submission_id": upload.source_submission_id,
        "created_at": upload.created_at,
        "updated_at": upload.updated_at,
        "assigned_file_count": assigned_file_count,
        "unassigned_file_count": max(0, len(file_paths) - assigned_file_count),
        "bound_relations": relation_bindings,
    }


def sync_upload_bundle(
    db: Session,
    *,
    user_id: uuid.UUID,
    storage_batch_id: str,
    text_paths: list[str],
    audio_paths: list[str],
    image_paths: list[str],
    video_paths: list[str],
    source_submission_id: uuid.UUID | None = None,
) -> list[UserUpload]:
    bundles = {
        "text": list(text_paths or []),
        "audio": list(audio_paths or []),
        "image": list(image_paths or []),
        "video": list(video_paths or []),
    }

    changed: list[UserUpload] = []
    for upload_type, file_paths in bundles.items():
        if not file_paths:
            continue
        row = upload_repository.get_by_batch_type(
            db,
            user_id=user_id,
            storage_batch_id=storage_batch_id,
            upload_type=upload_type,
        )
        if row is None:
            row = UserUpload(
                user_id=user_id,
                storage_batch_id=storage_batch_id,
                upload_type=upload_type,
                file_paths=file_paths,
                source_submission_id=source_submission_id,
            )
            db.add(row)
        else:
            row.file_paths = file_paths
            row.source_submission_id = source_submission_id
            db.add(row)
        changed.append(row)

    if not changed:
        return []

    db.commit()
    for row in changed:
        db.refresh(row)
    return changed


def sync_submission_uploads(
    db: Session,
    *,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    storage_batch_id: str,
    text_paths: list[str],
    audio_paths: list[str],
    image_paths: list[str],
    video_paths: list[str],
) -> list[UserUpload]:
    return sync_upload_bundle(
        db,
        user_id=user_id,
        storage_batch_id=storage_batch_id,
        text_paths=text_paths,
        audio_paths=audio_paths,
        image_paths=image_paths,
        video_paths=video_paths,
        source_submission_id=submission_id,
    )


def list_uploads(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[dict[str, Any]]:
    uploads = upload_repository.list_for_user(db, user_id=user_id, limit=limit)
    bindings, files, assigned_counts = _build_relation_binding_payload(uploads=uploads, user_id=user_id, db=db)
    return [
        _build_upload_item(
            upload=item,
            relation_bindings=bindings.get(item.id),
            files=files.get(item.id),
            assigned_file_count=assigned_counts.get(item.id, 0),
        )
        for item in uploads
    ]


def assign_upload_to_relation(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_id: uuid.UUID,
    relation_profile_id: uuid.UUID,
    file_paths: list[str] | None = None,
    memory_scope: str = "short_term",
) -> dict[str, Any]:
    upload = upload_repository.get_for_user(db, user_id=user_id, upload_id=upload_id)
    if upload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传记录不存在")

    relation = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_profile_id,
    )
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    normalized_paths = [path.strip() for path in (file_paths or upload.file_paths or []) if path and path.strip()]
    if not normalized_paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="没有可归档文件")

    upload_path_set = set(upload.file_paths or [])
    invalid = [path for path in normalized_paths if path not in upload_path_set]
    if invalid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="存在无效文件路径")

    existing_links = relation_repository.list_existing_links(
        db,
        relation_profile_id=relation_profile_id,
        user_upload_id=upload.id,
        file_paths=normalized_paths,
    )
    existing_set = {item.file_path for item in existing_links}
    new_paths = [path for path in normalized_paths if path not in existing_set]

    if new_paths:
        for path in new_paths:
            db.add(
                UserRelationUploadLink(
                    user_id=user_id,
                    relation_profile_id=relation.id,
                    user_upload_id=upload.id,
                    file_path=path,
                    source_submission_id=upload.source_submission_id,
                )
            )

        db.add(
            UserRelationMemory(
                user_id=user_id,
                relation_profile_id=relation.id,
                memory_scope=_validate_memory_scope(memory_scope),
                memory_kind="upload",
                title=_upload_title(upload.upload_type, len(new_paths)),
                content=_upload_content(new_paths),
                extra_payload={
                    "upload_id": str(upload.id),
                    "upload_type": upload.upload_type,
                    "storage_batch_id": upload.storage_batch_id,
                    "file_count": len(new_paths),
                    "file_paths": new_paths,
                },
                source_submission_id=upload.source_submission_id,
                source_upload_id=upload.id,
            )
        )
        db.commit()

    refreshed = upload_repository.get_for_user(db, user_id=user_id, upload_id=upload.id)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传记录不存在")

    bindings, files, assigned_counts = _build_relation_binding_payload(
        uploads=[refreshed],
        user_id=user_id,
        db=db,
    )
    return _build_upload_item(
        upload=refreshed,
        relation_bindings=bindings.get(refreshed.id),
        files=files.get(refreshed.id),
        assigned_file_count=assigned_counts.get(refreshed.id, 0),
    )
