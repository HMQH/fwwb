"""Relation and memory service."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection import repository as detection_repository
from app.domain.detection.entity import DetectionResult
from app.domain.detection.llm import build_chat_json_client
from app.domain.relations import profile_prompts
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
_RELATION_TYPE_LABELS = {
    "family": "亲友",
    "friend": "朋友",
    "classmate": "同学",
    "stranger": "陌生人",
    "colleague": "同事",
}

_RELATION_TYPE_SET = {"family", "friend", "classmate", "stranger", "colleague"}
_MEMORY_SCOPE_SET = {"short_term", "long_term"}
_MEMORY_KIND_SET = {"upload", "chat", "note", "summary"}
_RELATION_PROFILE_MEMORY_LIMIT = 10
_RELATION_PROFILE_SNAPSHOT_LIMIT = 3
_RELATION_PROFILE_DETECTION_LIMIT = 4
_RELATION_PROFILE_SUMMARY_TITLE = "对象画像快照"
_RELATION_PROFILE_SUMMARY_MAX_LENGTH = 220
_UPLOAD_TYPE_LABELS = {"text": "文本", "audio": "音频", "image": "图片", "video": "视频"}


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
    return _clean_text_list(tags, item_max_length=16, limit=6)


def _clean_text_list(
    values: list[Any] | None,
    *,
    item_max_length: int,
    limit: int,
) -> list[str]:
    if not values:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        if item is None:
            continue
        cleaned = _clean_text(str(item), max_length=item_max_length)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
        if len(result) >= limit:
            break
    return result


def _clamp_float(value: Any, *, minimum: float, maximum: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _json_digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha1(encoded).hexdigest()


def _is_relation_ai_summary_memory(memory: UserRelationMemory) -> bool:
    extra_payload = memory.extra_payload if isinstance(memory.extra_payload, dict) else {}
    source = _clean_text(extra_payload.get("source") if isinstance(extra_payload.get("source"), str) else None)
    return memory.memory_kind == "summary" and source == "relation_ai_profile"


def _relation_memory_content_for_prompt(memory: UserRelationMemory) -> str | None:
    extra_payload = memory.extra_payload if isinstance(memory.extra_payload, dict) else {}
    if memory.memory_kind == "upload":
        upload_type = _clean_text(
            extra_payload.get("upload_type") if isinstance(extra_payload.get("upload_type"), str) else None,
            fallback="素材",
            max_length=16,
        ) or "素材"
        file_count = 0
        try:
            file_count = int(extra_payload.get("file_count") or 0)
        except (TypeError, ValueError):
            file_count = 0
        label = _UPLOAD_TYPE_LABELS.get(upload_type, upload_type)
        if file_count > 0:
            return f"已关联{label} {file_count} 项"
        return f"已关联{label}"
    return _clean_text(memory.content, max_length=180)


def _relation_memory_prompt_items(memories: list[UserRelationMemory], *, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for memory in memories:
        if _is_relation_ai_summary_memory(memory):
            continue
        content = _relation_memory_content_for_prompt(memory)
        if not content:
            continue
        items.append(
            {
                "id": str(memory.id),
                "memory_scope": memory.memory_scope,
                "memory_kind": memory.memory_kind,
                "title": _clean_text(memory.title, fallback="记忆", max_length=28) or "记忆",
                "content": content,
                "happened_at": _isoformat(memory.happened_at),
                "created_at": _isoformat(memory.created_at),
                "source_submission_id": str(memory.source_submission_id) if memory.source_submission_id else None,
                "source_upload_id": str(memory.source_upload_id) if memory.source_upload_id else None,
            }
        )
        if len(items) >= limit:
            break
    return items


def _relation_profile_snapshots(memories: list[UserRelationMemory], *, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for memory in memories:
        if not _is_relation_ai_summary_memory(memory):
            continue
        extra_payload = memory.extra_payload if isinstance(memory.extra_payload, dict) else {}
        items.append(
            {
                "id": str(memory.id),
                "content": _clean_text(memory.content, max_length=_RELATION_PROFILE_SUMMARY_MAX_LENGTH) or "",
                "created_at": _isoformat(memory.created_at),
                "confidence": _clamp_float(extra_payload.get("confidence"), minimum=0.0, maximum=1.0, fallback=0.0),
                "query_tags": _clean_tags(extra_payload.get("query_tags") if isinstance(extra_payload.get("query_tags"), list) else []),
            }
        )
        if len(items) >= limit:
            break
    return items


def _relation_upload_overview(links: list[UserRelationUploadLink], uploads: list[UserUpload]) -> dict[str, Any]:
    upload_map = {item.id: item for item in uploads}
    counts: dict[str, int] = {}
    for link in links:
        upload = upload_map.get(link.user_upload_id)
        upload_type = upload.upload_type if upload is not None else None
        if upload_type:
            counts[upload_type] = counts.get(upload_type, 0) + 1
    return {
        "linked_upload_count": len({item.user_upload_id for item in links}),
        "file_count": len({item.file_path for item in links}),
        "file_type_counts": counts,
    }


def _relation_detection_briefs(
    db: Session,
    *,
    memories: list[UserRelationMemory],
    links: list[UserRelationUploadLink],
) -> list[dict[str, Any]]:
    submission_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for memory in memories:
        if memory.source_submission_id and memory.source_submission_id not in seen:
            seen.add(memory.source_submission_id)
            submission_ids.append(memory.source_submission_id)
    for link in links:
        if link.source_submission_id and link.source_submission_id not in seen:
            seen.add(link.source_submission_id)
            submission_ids.append(link.source_submission_id)

    items: list[dict[str, Any]] = []
    for submission_id in submission_ids[:_RELATION_PROFILE_DETECTION_LIMIT]:
        result = detection_repository.get_latest_result_for_submission(db, submission_id=submission_id)
        if result is None:
            continue
        items.append(
            {
                "submission_id": str(submission_id),
                "risk_level": _clean_text(result.risk_level, max_length=12),
                "fraud_type": _clean_text(result.fraud_type, max_length=24),
                "summary": _clean_text(result.summary, max_length=140),
                "final_reason": _clean_text(result.final_reason, max_length=180),
                "confidence": _clamp_float(result.confidence, minimum=0.0, maximum=1.0, fallback=0.0),
                "created_at": _isoformat(result.created_at),
            }
        )
    return items


def _build_relation_profile_input(
    db: Session,
    *,
    user_id: uuid.UUID,
    profile: UserRelationProfile,
    memories: list[UserRelationMemory],
    links: list[UserRelationUploadLink],
) -> dict[str, Any]:
    upload_ids = list({item.user_upload_id for item in links})
    uploads = upload_repository.list_by_ids_for_user(db, user_id=user_id, upload_ids=upload_ids)
    return {
        "base_profile": {
            "id": str(profile.id),
            "relation_type": profile.relation_type,
            "relation_type_label": _RELATION_TYPE_LABELS.get(profile.relation_type, profile.relation_type),
            "name": profile.name,
            "description": profile.description,
            "tags": list(profile.tags or []),
        },
        "existing_summary": _clean_text(profile.ai_profile_summary, max_length=_RELATION_PROFILE_SUMMARY_MAX_LENGTH),
        "prior_summary_snapshots": _relation_profile_snapshots(memories, limit=_RELATION_PROFILE_SNAPSHOT_LIMIT),
        "recent_memories": _relation_memory_prompt_items(memories, limit=_RELATION_PROFILE_MEMORY_LIMIT),
        "upload_overview": _relation_upload_overview(links, uploads),
        "detection_briefs": _relation_detection_briefs(db, memories=memories, links=links),
    }


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
        "ai_profile_summary": profile.ai_profile_summary,
        "ai_profile_payload": dict(profile.ai_profile_payload or {}),
        "ai_profile_dirty": bool(profile.ai_profile_dirty),
        "ai_profile_updated_at": profile.ai_profile_updated_at,
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


def _has_relation_profile_evidence(profile_input: dict[str, Any]) -> bool:
    base_profile = profile_input.get("base_profile") if isinstance(profile_input.get("base_profile"), dict) else {}
    description = _clean_text(base_profile.get("description"), max_length=120)
    tags = base_profile.get("tags") if isinstance(base_profile.get("tags"), list) else []
    recent_memories = profile_input.get("recent_memories") if isinstance(profile_input.get("recent_memories"), list) else []
    upload_overview = profile_input.get("upload_overview") if isinstance(profile_input.get("upload_overview"), dict) else {}
    detection_briefs = profile_input.get("detection_briefs") if isinstance(profile_input.get("detection_briefs"), list) else []
    return bool(
        description
        or tags
        or recent_memories
        or (upload_overview.get("file_count") or 0) > 0
        or detection_briefs
    )


def _build_relation_profile_fallback(profile_input: dict[str, Any]) -> dict[str, Any]:
    base_profile = profile_input.get("base_profile") if isinstance(profile_input.get("base_profile"), dict) else {}
    upload_overview = profile_input.get("upload_overview") if isinstance(profile_input.get("upload_overview"), dict) else {}
    detection_briefs = profile_input.get("detection_briefs") if isinstance(profile_input.get("detection_briefs"), list) else []
    recent_memories = profile_input.get("recent_memories") if isinstance(profile_input.get("recent_memories"), list) else []

    relation_name = _clean_text(base_profile.get("name"), max_length=24, fallback="该对象") or "该对象"
    relation_label = _clean_text(base_profile.get("relation_type_label"), max_length=12) or "关系对象"
    description = _clean_text(base_profile.get("description"), max_length=80)
    tags = _clean_tags(base_profile.get("tags") if isinstance(base_profile.get("tags"), list) else [])
    stable_traits: list[str] = []
    if description:
        stable_traits.append(description)
    stable_traits.extend(tags[:3])

    communication_style: list[str] = []
    caution_points: list[str] = []
    risk_signals: list[str] = []
    trusted_signals: list[str] = []
    query_tags = [relation_name, relation_label]

    first_note = next(
        (
            _clean_text(item.get("content"), max_length=60)
            for item in recent_memories
            if isinstance(item, dict) and item.get("memory_kind") in {"chat", "note"} and item.get("content")
        ),
        None,
    )
    if first_note:
        communication_style.append(first_note)

    if detection_briefs:
        first_detection = detection_briefs[0] if isinstance(detection_briefs[0], dict) else {}
        fraud_type = _clean_text(first_detection.get("fraud_type"), max_length=24)
        risk_level = _clean_text(first_detection.get("risk_level"), max_length=12)
        summary = _clean_text(first_detection.get("summary"), max_length=80)
        if fraud_type:
            risk_signals.append(f"近期关联到{fraud_type}线索")
            query_tags.append(fraud_type)
        elif risk_level:
            risk_signals.append(f"近期出现{risk_level}风险检测结论")
            query_tags.append(risk_level)
        if summary:
            caution_points.append(summary)

    file_count = 0
    try:
        file_count = int(upload_overview.get("file_count") or 0)
    except (TypeError, ValueError):
        file_count = 0
    if file_count > 0:
        trusted_signals.append(f"已绑定 {file_count} 份关联素材")

    summary_parts = [f"{relation_name}是用户的{relation_label}。"]
    if description:
        summary_parts.append(f"备注信息显示：{description}。")
    if risk_signals:
        summary_parts.append(f"近期画像重点：{risk_signals[0]}。")
    if trusted_signals:
        summary_parts.append(f"当前可核验资料：{trusted_signals[0]}。")
    profile_summary = _clean_text("".join(summary_parts), max_length=_RELATION_PROFILE_SUMMARY_MAX_LENGTH, fallback="") or ""

    return {
        "should_update": bool(profile_summary),
        "profile_summary": profile_summary,
        "stable_traits": stable_traits[:4],
        "communication_style": communication_style[:3],
        "risk_signals": risk_signals[:4],
        "trusted_signals": trusted_signals[:4],
        "caution_points": caution_points[:4],
        "query_tags": _clean_tags(query_tags),
        "confidence": 0.38 if profile_summary else 0.0,
        "update_reason": "基于现有资料执行规则化回退生成。",
    }


def _normalize_relation_profile_payload(raw: dict[str, Any], *, fallback: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "should_update": bool(raw.get("should_update")),
        "profile_summary": _clean_text(raw.get("profile_summary"), max_length=_RELATION_PROFILE_SUMMARY_MAX_LENGTH, fallback="") or "",
        "stable_traits": _clean_text_list(
            raw.get("stable_traits") if isinstance(raw.get("stable_traits"), list) else [],
            item_max_length=32,
            limit=4,
        ),
        "communication_style": _clean_text_list(
            raw.get("communication_style") if isinstance(raw.get("communication_style"), list) else [],
            item_max_length=48,
            limit=3,
        ),
        "risk_signals": _clean_text_list(
            raw.get("risk_signals") if isinstance(raw.get("risk_signals"), list) else [],
            item_max_length=48,
            limit=4,
        ),
        "trusted_signals": _clean_text_list(
            raw.get("trusted_signals") if isinstance(raw.get("trusted_signals"), list) else [],
            item_max_length=48,
            limit=4,
        ),
        "caution_points": _clean_text_list(
            raw.get("caution_points") if isinstance(raw.get("caution_points"), list) else [],
            item_max_length=60,
            limit=4,
        ),
        "query_tags": _clean_tags(raw.get("query_tags") if isinstance(raw.get("query_tags"), list) else []),
        "confidence": _clamp_float(raw.get("confidence"), minimum=0.0, maximum=1.0, fallback=0.0),
        "update_reason": _clean_text(raw.get("update_reason"), max_length=120, fallback="") or "",
    }
    if not normalized["profile_summary"] and fallback.get("profile_summary"):
        normalized["profile_summary"] = str(fallback.get("profile_summary") or "")
    if not normalized["query_tags"] and isinstance(fallback.get("query_tags"), list):
        normalized["query_tags"] = _clean_tags(fallback.get("query_tags"))
    list_specs = {
        "stable_traits": (32, 4),
        "communication_style": (48, 3),
        "risk_signals": (48, 4),
        "trusted_signals": (48, 4),
        "caution_points": (60, 4),
    }
    for key, (item_max_length, limit) in list_specs.items():
        if not normalized[key] and isinstance(fallback.get(key), list):
            normalized[key] = _clean_text_list(fallback.get(key), item_max_length=item_max_length, limit=limit)
    if not normalized["update_reason"] and fallback.get("update_reason"):
        normalized["update_reason"] = str(fallback.get("update_reason") or "")
    if normalized["profile_summary"]:
        normalized["should_update"] = True
    return normalized


def _append_relation_profile_snapshot(
    db: Session,
    *,
    profile: UserRelationProfile,
    memories: list[UserRelationMemory],
    summary: str,
    payload: dict[str, Any],
    trigger: str,
    source_digest: str,
    happened_at: datetime,
) -> None:
    latest_snapshot = next((item for item in memories if _is_relation_ai_summary_memory(item)), None)
    latest_payload = latest_snapshot.extra_payload if latest_snapshot and isinstance(latest_snapshot.extra_payload, dict) else {}
    latest_digest = _clean_text(
        latest_payload.get("source_digest") if isinstance(latest_payload.get("source_digest"), str) else None,
        fallback="",
    ) or ""
    if latest_snapshot is not None and _clean_text(latest_snapshot.content, fallback="") == summary and latest_digest == source_digest:
        return

    db.add(
        UserRelationMemory(
            user_id=profile.user_id,
            relation_profile_id=profile.id,
            memory_scope="long_term",
            memory_kind="summary",
            title=_RELATION_PROFILE_SUMMARY_TITLE,
            content=summary,
            extra_payload={
                "source": "relation_ai_profile",
                "confidence": payload.get("confidence"),
                "query_tags": payload.get("query_tags") or [],
                "stable_traits": payload.get("stable_traits") or [],
                "risk_signals": payload.get("risk_signals") or [],
                "trusted_signals": payload.get("trusted_signals") or [],
                "caution_points": payload.get("caution_points") or [],
                "update_reason": payload.get("update_reason"),
                "trigger": trigger,
                "source_digest": source_digest,
            },
            happened_at=happened_at,
        )
    )


def refresh_relation_ai_profile(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    trigger: str,
    force: bool = False,
) -> None:
    profile = relation_repository.get_profile_for_user(db, user_id=user_id, relation_id=relation_id)
    if profile is None:
        return

    memories = relation_repository.list_memories_for_relation(db, user_id=user_id, relation_id=profile.id)
    links = relation_repository.list_links_for_relation(db, user_id=user_id, relation_id=profile.id)
    existing_payload = dict(profile.ai_profile_payload or {})
    profile_input = _build_relation_profile_input(db, user_id=user_id, profile=profile, memories=memories, links=links)
    source_digest = _json_digest(profile_input)
    now = _utcnow()

    if not _has_relation_profile_evidence(profile_input):
        profile.ai_profile_dirty = True
        profile.ai_profile_payload = {
            **existing_payload,
            "status": "waiting_for_evidence",
            "last_trigger": trigger,
            "last_attempt_at": now.isoformat(),
            "source_digest": source_digest,
        }
        db.add(profile)
        db.commit()
        return

    previous_digest = _clean_text(
        existing_payload.get("source_digest") if isinstance(existing_payload.get("source_digest"), str) else None,
        fallback="",
    ) or ""
    if not force and previous_digest == source_digest and _clean_text(profile.ai_profile_summary, fallback=""):
        profile.ai_profile_dirty = False
        profile.ai_profile_payload = {
            **existing_payload,
            "status": "up_to_date",
            "last_trigger": trigger,
            "last_checked_at": now.isoformat(),
            "source_digest": source_digest,
        }
        db.add(profile)
        db.commit()
        return

    fallback_payload = _build_relation_profile_fallback(profile_input)
    llm_error: str | None = None
    llm_model_name: str | None = None
    status_label = "llm"
    try:
        system_prompt, user_prompt = profile_prompts.build_relation_profile_prompts(
            trigger=trigger,
            base_profile=profile_input["base_profile"],
            existing_summary=profile_input["existing_summary"],
            prior_summary_snapshots=profile_input["prior_summary_snapshots"],
            recent_memories=profile_input["recent_memories"],
            upload_overview=profile_input["upload_overview"],
            detection_briefs=profile_input["detection_briefs"],
        )
        llm_result = build_chat_json_client().complete_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        llm_model_name = llm_result.model_name
        normalized_payload = _normalize_relation_profile_payload(llm_result.payload, fallback=fallback_payload)
    except Exception as exc:  # noqa: BLE001
        llm_error = str(exc)
        status_label = "fallback"
        normalized_payload = _normalize_relation_profile_payload(fallback_payload, fallback=fallback_payload)

    final_summary = normalized_payload.get("profile_summary") or _clean_text(profile.ai_profile_summary, fallback="") or ""
    normalized_payload["profile_summary"] = final_summary
    normalized_payload["should_update"] = bool(final_summary)
    profile.ai_profile_summary = final_summary or None
    profile.ai_profile_updated_at = now
    profile.ai_profile_dirty = False
    profile.ai_profile_payload = {
        **normalized_payload,
        "status": status_label,
        "last_trigger": trigger,
        "source_digest": source_digest,
        "last_refreshed_at": now.isoformat(),
        **({"llm_model": llm_model_name} if llm_model_name else {}),
        **({"last_error": llm_error} if llm_error else {}),
    }
    db.add(profile)
    if final_summary:
        _append_relation_profile_snapshot(
            db,
            profile=profile,
            memories=memories,
            summary=final_summary,
            payload=profile.ai_profile_payload,
            trigger=trigger,
            source_digest=source_digest,
            happened_at=now,
        )
    db.commit()


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
    refresh_relation_ai_profile(
        db,
        user_id=user_id,
        relation_id=row.id,
        trigger="profile_created",
    )
    db.refresh(row)
    memories = relation_repository.list_memories_for_relation(db, user_id=user_id, relation_id=row.id)
    links = relation_repository.list_links_for_relation(db, user_id=user_id, relation_id=row.id)
    return _build_profile_summary(
        row,
        memories=memories,
        links_count=len({item.user_upload_id for item in links}),
        file_count=len({item.file_path for item in links}),
    )


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
    refresh_relation_ai_profile(
        db,
        user_id=user_id,
        relation_id=profile.id,
        trigger="profile_updated",
    )
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
    refresh_relation_ai_profile(
        db,
        user_id=user_id,
        relation_id=relation.id,
        trigger="memory_created",
    )
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
    refresh_relation_ai_profile(
        db,
        user_id=user_id,
        relation_id=relation_id,
        trigger="memory_scope_updated",
    )
    return _memory_snapshot(memory)


def attach_detection_result(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_id: uuid.UUID | None,
    submission_id: uuid.UUID,
    result: DetectionResult,
) -> None:
    if relation_id is None:
        return

    relation = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_id,
    )
    if relation is None:
        return

    title = _clean_text(result.fraud_type, max_length=28) or _clean_text(result.risk_level, max_length=28) or "检测结论"
    content = _clean_text(result.summary, max_length=240) or _clean_text(result.final_reason, max_length=240)
    if not content:
        return

    memories = relation_repository.list_memories_for_relation(db, user_id=user_id, relation_id=relation.id)
    existing = next(
        (
            item
            for item in memories
            if item.source_submission_id == submission_id
            and item.memory_kind == "summary"
            and isinstance(item.extra_payload, dict)
            and item.extra_payload.get("source") == "detection_result"
        ),
        None,
    )
    payload = {
        "source": "detection_result",
        "risk_level": result.risk_level,
        "fraud_type": result.fraud_type,
        "confidence": result.confidence,
        "need_manual_review": result.need_manual_review,
        "stage_tags": list(result.stage_tags or []),
        "hit_rules": list(result.hit_rules or []),
        "final_reason": _clean_text(result.final_reason, max_length=180),
    }

    if existing is None:
        db.add(
            UserRelationMemory(
                user_id=user_id,
                relation_profile_id=relation.id,
                memory_scope="short_term",
                memory_kind="summary",
                title=title,
                content=content,
                extra_payload=payload,
                source_submission_id=submission_id,
                happened_at=_utcnow(),
            )
        )
    else:
        existing.title = title
        existing.content = content
        existing.extra_payload = payload
        existing.happened_at = _utcnow()
        db.add(existing)

    db.commit()
    refresh_relation_ai_profile(
        db,
        user_id=user_id,
        relation_id=relation.id,
        trigger="detection_result_attached",
    )


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
        refresh_relation_ai_profile(
            db,
            user_id=user_id,
            relation_id=relation.id,
            trigger="submission_attached",
        )
