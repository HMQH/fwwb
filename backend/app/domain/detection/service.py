"""检测任务编排与执行服务。"""
from __future__ import annotations

from collections import defaultdict
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection import analyzer, repository as detection_repository
from app.domain.detection.entity import DetectionJob, DetectionResult, DetectionSubmission
from app.domain.detection.kinds import UploadKind
from app.domain.guardians import service as guardian_service
from app.domain.image_fraud import service as image_fraud_service
from app.domain.video_deception_detector import service as video_deception_service
from app.domain.video_ai_detector import service as video_ai_service
from app.domain.relations import repository as relation_repository
from app.domain.relations import service as relation_service
from app.domain.uploads.entity import UserUpload
from app.domain.uploads import repository as upload_repository
from app.domain.uploads import service as upload_service
from app.domain.user import repository as user_repository
from app.domain.user import profile_memory as user_profile_memory
from app.shared.core.config import settings
from app.shared.db.session import SessionLocal
from app.shared.observability.langsmith import configure_langsmith_environment, traceable, tracing_session
from app.shared.storage.file_validation import validate_bundle_filenames
from app.shared.storage.upload_paths import (
    allocate_batch_folder_name,
    resolved_upload_root,
    safe_suffix,
    save_upload_bytes,
)
from app.domain.agent.fraud_types import (
    FRAUD_TYPE_FORGED_DOC,
    FRAUD_TYPE_IMPERSONATION,
    FRAUD_TYPE_PHISHING_IMAGE,
    FRAUD_TYPE_PHISHING_SITE,
    FRAUD_TYPE_PII,
    FRAUD_TYPE_SUSPICIOUS_QR,
    FRAUD_TYPE_VOICE_SCAM_CALL,
)
from app.domain.agent.trace import action_label

logger = logging.getLogger(__name__)

_TEXT_DECODE_SUFFIXES = {".txt", ".md", ".json", ".csv", ".log", ".html", ".htm"}
_HISTORY_SCOPES = {"day", "month", "year"}
_LOCAL_TIMEZONE = ZoneInfo("Asia/Shanghai")
_AUDIO_VERIFY_MODEL_LABEL = "audio-verify-v1"
_VIDEO_AI_MODEL_LABEL = video_ai_service.MODEL_LABEL
_VIDEO_PHYSIOLOGY_MODEL_LABEL = video_deception_service.MODEL_LABEL
_PIPELINE_STEPS = [
    ("preprocess", "清洗"),
    ("embedding", "编码"),
    ("vector_retrieval", "召回"),
    ("graph_reasoning", "图谱"),
    ("llm_reasoning", "判别"),
    ("finalize", "完成"),
]
_PROGRESS_CONTEXT_KEYS = (
    "submission_id",
    "input_modality",
    "job_type",
    "analysis_mode",
    "deep_reasoning",
    "analysis_mode_source",
    "video_analysis_target",
)

def _load_audio_detector_module():
    from app.domain.detection import audio_detector as audio_detector_module

    return audio_detector_module


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _local_now() -> datetime:
    return datetime.now(_LOCAL_TIMEZONE)


def _strip(s: str | None) -> str:
    return (s or "").strip()


def _risk_level_rank(level: str | None) -> int:
    return {
        "high": 3,
        "medium": 2,
        "low": 1,
    }.get(_strip(level).lower(), 0)


def _analysis_mode_value(*, deep_reasoning: bool) -> str:
    return "deep" if deep_reasoning else "standard"


def _analysis_mode_source(*, requested: bool | None, resolved: bool) -> str:
    if isinstance(requested, bool):
        return "request"
    return "default_text_deep" if resolved else "default_standard"


def _normalize_video_analysis_target(value: Any) -> str | None:
    normalized = _strip(str(value or "")).lower().replace("_", "-")
    if normalized in {"ai", "video-ai"}:
        return "ai"
    if normalized in {"physiology", "video-physiology"}:
        return "physiology"
    return None


def _job_video_analysis_target(job: DetectionJob | None) -> str | None:
    if job is None:
        return None
    progress_detail = dict(job.progress_detail or {})
    return _normalize_video_analysis_target(progress_detail.get("video_analysis_target"))


def _job_uses_deep_reasoning(job: DetectionJob | None) -> bool:
    if job is None:
        return False
    progress_detail = dict(job.progress_detail or {})
    if progress_detail.get("deep_reasoning") is True:
        return True
    return str(progress_detail.get("analysis_mode") or "").strip().lower() == "deep"


def _preserve_progress_context(
    job: DetectionJob,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    preserved: dict[str, Any] = {}
    progress_detail = dict(job.progress_detail or {})
    for key in _PROGRESS_CONTEXT_KEYS:
        if key in progress_detail and progress_detail.get(key) is not None:
            preserved[key] = progress_detail.get(key)
    if extra:
        preserved.update(extra)
    return preserved or None


def normalize_history_scope(scope: str | None) -> str:
    normalized = _strip(scope).lower()
    return normalized if normalized in _HISTORY_SCOPES else "month"


def _month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _year_start(value: datetime) -> datetime:
    return value.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _history_filter_window(scope: str) -> tuple[datetime, datetime]:
    now_local = _local_now()
    if scope == "day":
        start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    elif scope == "year":
        start_local = _year_start(now_local)
    else:
        start_local = _month_start(now_local)
    return start_local.astimezone(timezone.utc), now_local.astimezone(timezone.utc)


def _analytics_window(scope: str) -> tuple[datetime, datetime]:
    now_local = _local_now()
    if scope == "day":
        start_local = _month_start(now_local)
    elif scope == "year":
        start_local = _year_start(now_local).replace(year=now_local.year - 4)
    else:
        start_local = _year_start(now_local)
    return start_local.astimezone(timezone.utc), now_local.astimezone(timezone.utc)


def _next_bucket_start(cursor: datetime, scope: str) -> datetime:
    if scope == "day":
        return cursor + timedelta(days=1)
    if scope == "month":
        if cursor.month == 12:
            return cursor.replace(year=cursor.year + 1, month=1, day=1)
        return cursor.replace(month=cursor.month + 1, day=1)
    return cursor.replace(year=cursor.year + 1, month=1, day=1)


def _bucket_key(value: datetime, scope: str) -> str:
    if scope == "day":
        return value.strftime("%Y-%m-%d")
    if scope == "month":
        return value.strftime("%Y-%m")
    return value.strftime("%Y")


def _bucket_label(value: datetime, scope: str) -> str:
    if scope == "day":
        return value.strftime("%m-%d")
    if scope == "month":
        return f"{value.month}月"
    return value.strftime("%Y")


def _build_trend_points(
    *,
    rows: list[tuple[datetime, str | None]],
    scope: str,
) -> list[dict[str, Any]]:
    start_at, end_at = _analytics_window(scope)
    start_local = start_at.astimezone(_LOCAL_TIMEZONE)
    end_local = end_at.astimezone(_LOCAL_TIMEZONE)

    counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"high": 0, "medium": 0, "low": 0, "total": 0}
    )

    for created_at, risk_level in rows:
        if created_at is None:
            continue
        created_local = created_at.astimezone(_LOCAL_TIMEZONE)
        key = _bucket_key(created_local, scope)
        counts[key]["total"] += 1
        if risk_level in {"high", "medium", "low"}:
            counts[key][risk_level] += 1

    points: list[dict[str, Any]] = []
    cursor = start_local
    while cursor <= end_local:
        key = _bucket_key(cursor, scope)
        bucket_counts = counts[key]
        points.append(
            {
                "bucket_key": key,
                "label": _bucket_label(cursor, scope),
                "high": bucket_counts["high"],
                "medium": bucket_counts["medium"],
                "low": bucket_counts["low"],
                "total": bucket_counts["total"],
            }
        )
        cursor = _next_bucket_start(cursor, scope)

    return points


def _decode_text_blob(data: bytes, filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix not in _TEXT_DECODE_SUFFIXES:
        return None
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _truncate_for_storage(text: str) -> str:
    normalized = text.strip()
    if len(normalized) <= settings.detection_text_storage_limit:
        return normalized
    return normalized[: settings.detection_text_storage_limit].rstrip() + "\n\n[已截断]"


def _build_merged_text_content(
    *,
    text_content: str | None,
    text_items: list[tuple[bytes, str]],
) -> str | None:
    parts: list[str] = []
    base_text = _strip(text_content)
    if base_text:
        parts.append(base_text)
    for data, filename in text_items:
        decoded = _decode_text_blob(data, filename)
        if decoded:
            parts.append(decoded)
    if not parts:
        return None
    return _truncate_for_storage("\n\n".join(part.strip() for part in parts if part and part.strip()))


def _build_module_trace(current_step: str | None, *, status: str) -> list[dict[str, Any]]:
    if status == "completed":
        current_index = len(_PIPELINE_STEPS) - 1
    elif status == "failed":
        current_index = max(0, next((i for i, (key, _) in enumerate(_PIPELINE_STEPS) if key == current_step), 0))
    else:
        current_index = next((i for i, (key, _) in enumerate(_PIPELINE_STEPS) if key == current_step), -1)

    trace: list[dict[str, Any]] = []
    for index, (key, label) in enumerate(_PIPELINE_STEPS):
        if status == "completed":
            step_status = "completed"
        elif status == "failed":
            if index < current_index:
                step_status = "completed"
            elif index == current_index:
                step_status = "failed"
            else:
                step_status = "pending"
        else:
            if current_index < 0:
                step_status = "pending"
            elif index < current_index:
                step_status = "completed"
            elif index == current_index:
                step_status = "running"
            else:
                step_status = "pending"
        trace.append({"key": key, "label": label, "status": step_status})
    return trace


def _build_progress_detail(
    *,
    current_step: str | None,
    status: str,
    percent: int,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    detail: dict[str, Any] = {
        "status": status,
        "current_step": current_step,
        "progress_percent": percent,
        "module_trace": _build_module_trace(current_step, status=status),
    }
    if extra:
        detail.update(extra)
        detail.setdefault("module_trace", _build_module_trace(current_step, status=status))
    return detail


def _set_job_progress(
    db: Session,
    job: DetectionJob,
    *,
    status: str | None = None,
    step: str | None = None,
    percent: int | None = None,
    extra: dict[str, Any] | None = None,
) -> DetectionJob:
    if status is not None:
        job.status = status
    if step is not None:
        job.current_step = step
    if percent is not None:
        job.progress_percent = max(0, min(100, int(percent)))
    current_step = job.current_step or "queued"
    current_percent = max(0, min(100, int(job.progress_percent or 0)))
    payload = _preserve_progress_context(job, extra)
    job.progress_detail = _build_progress_detail(
        current_step=current_step,
        status=job.status,
        percent=current_percent,
        extra=payload,
    )
    return detection_repository.save_job(db, job)


def _initialize_job_progress(
    db: Session,
    job: DetectionJob,
    *,
    extra: dict[str, Any] | None = None,
) -> DetectionJob:
    payload = {
        "input_modality": job.input_modality,
        "job_type": job.job_type,
    }
    if extra:
        payload.update(extra)
    return _set_job_progress(
        db,
        job,
        status=job.status,
        step=job.current_step or "queued",
        percent=0,
        extra=payload,
    )


def create_submission(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_root_cfg: str,
    max_upload_bytes: int,
    text_content: str | None,
    relation_profile_id: uuid.UUID | None,
    file_bundles: dict[UploadKind, list[tuple[bytes, str]]],
) -> DetectionSubmission:
    upload_root = resolved_upload_root(upload_root_cfg)

    for _kind, items in file_bundles.items():
        for data, _fn in items:
            if len(data) > max_upload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"单个文件超过 {max_upload_bytes} 字节限制",
                )

    validate_bundle_filenames(file_bundles)

    batch_folder = allocate_batch_folder_name(upload_root=upload_root, user_id=user_id)

    text_paths: list[str] = []
    audio_paths: list[str] = []
    image_paths: list[str] = []
    video_paths: list[str] = []

    for data, fn in file_bundles.get("text", []):
        if data:
            suf = safe_suffix(fn, ".txt")
            text_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="text",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("audio", []):
        if data:
            suf = safe_suffix(fn, ".m4a")
            audio_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="audio",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("image", []):
        if data:
            suf = safe_suffix(fn, ".jpg")
            image_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="image",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("video", []):
        if data:
            suf = safe_suffix(fn, ".mp4")
            video_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="video",
                    data=data,
                    suffix=suf,
                )
            )

    merged_text = _build_merged_text_content(
        text_content=text_content,
        text_items=file_bundles.get("text", []),
    )

    has_text = bool(merged_text) or bool(text_paths)
    has_audio = bool(audio_paths)
    has_image = bool(image_paths)
    has_video = bool(video_paths)

    if not (has_text or has_audio or has_image or has_video):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="提交内容为空，请至少提供文本或附件",
        )

    row = DetectionSubmission(
        user_id=user_id,
        relation_profile_id=relation_profile_id,
        storage_batch_id=batch_folder,
        has_text=has_text,
        has_audio=has_audio,
        has_image=has_image,
        has_video=has_video,
        text_paths=text_paths,
        audio_paths=audio_paths,
        image_paths=image_paths,
        video_paths=video_paths,
        text_content=merged_text,
    )
    return detection_repository.save_submission(db, row)


def _normalize_requested_paths(paths: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        item = _strip(raw)
        if not item or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少选择一个音频文件")
    return normalized


def _build_reused_storage_batch_id(prefix: str) -> str:
    return f"reuse-{prefix}-{_utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"


def _is_reused_audio_submission(submission: DetectionSubmission) -> bool:
    return bool(
        submission.storage_batch_id.startswith("reuse-audio-")
        and submission.audio_paths
        and not submission.image_paths
        and not submission.video_paths
        and not _strip(submission.text_content)
    )


def _group_upload_rows_by_selected_paths(
    *,
    upload_rows: list[UserUpload],
    selected_paths: list[str],
    submission_id: uuid.UUID,
) -> list[UserUpload]:
    selected_set = set(selected_paths)
    grouped_rows: list[UserUpload] = []
    for upload in upload_rows:
        matched_paths = [path for path in list(upload.file_paths or []) if path in selected_set]
        if not matched_paths:
            continue
        grouped_rows.append(
            UserUpload(
                id=upload.id,
                user_id=upload.user_id,
                storage_batch_id=upload.storage_batch_id,
                upload_type=upload.upload_type,
                file_paths=matched_paths,
                source_submission_id=submission_id,
            )
        )
    return grouped_rows


def _resolve_audio_upload_rows_for_paths(
    db: Session,
    *,
    user_id: uuid.UUID,
    audio_paths: list[str],
) -> list[UserUpload]:
    selected_paths = _normalize_requested_paths(audio_paths)
    upload_rows = upload_repository.list_for_user_by_type(
        db,
        user_id=user_id,
        upload_type="audio",
    )
    owned_paths = {
        path
        for upload in upload_rows
        for path in list(upload.file_paths or [])
    }
    invalid_paths = [path for path in selected_paths if path not in owned_paths]
    if invalid_paths:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="存在无效音频路径")
    return upload_rows


def _build_job_snapshot(job: DetectionJob, result: DetectionResult | None = None) -> dict[str, Any]:
    return {
        "id": job.id,
        "submission_id": job.submission_id,
        "job_type": job.job_type,
        "input_modality": job.input_modality,
        "status": job.status,
        "current_step": job.current_step,
        "progress_percent": job.progress_percent,
        "progress_detail": dict(job.progress_detail or {}),
        "rule_score": job.rule_score,
        "retrieval_query": job.retrieval_query,
        "llm_model": job.llm_model,
        "error_message": job.error_message,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "result": _build_result_snapshot(result) if result is not None else None,
    }


def _build_result_snapshot(result: DetectionResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {
        "id": result.id,
        "submission_id": result.submission_id,
        "job_id": result.job_id,
        "risk_level": result.risk_level,
        "fraud_type": result.fraud_type,
        "confidence": result.confidence,
        "is_fraud": result.is_fraud,
        "summary": result.summary,
        "final_reason": result.final_reason,
        "need_manual_review": result.need_manual_review,
        "stage_tags": list(result.stage_tags or []),
        "hit_rules": list(result.hit_rules or []),
        "rule_hits": list(result.rule_hits or []),
        "extracted_entities": dict(result.extracted_entities or {}),
        "input_highlights": list(result.input_highlights or []),
        "retrieved_evidence": list(result.retrieved_evidence or []),
        "counter_evidence": list(result.counter_evidence or []),
        "advice": list(result.advice or []),
        "llm_model": result.llm_model,
        "result_detail": result.result_detail or {},
        "created_at": result.created_at,
        "updated_at": result.updated_at,
    }


def _build_relation_profile_payload(db: Session, submission: DetectionSubmission) -> dict[str, Any]:
    payload = {
        "relation_profile_id": submission.relation_profile_id,
        "relation_profile_name": None,
        "relation_profile_type": None,
    }
    if submission.relation_profile_id is None:
        return payload

    profile = relation_repository.get_profile_for_user(
        db,
        user_id=submission.user_id,
        relation_id=submission.relation_profile_id,
    )
    if profile is None:
        return payload

    payload["relation_profile_name"] = profile.name
    payload["relation_profile_type"] = profile.relation_type
    return payload


def build_submission_payload(db: Session, submission: DetectionSubmission) -> dict[str, Any]:
    relation_payload = _build_relation_profile_payload(db, submission)
    return {
        "id": submission.id,
        "user_id": submission.user_id,
        "relation_profile_id": relation_payload["relation_profile_id"],
        "relation_profile_name": relation_payload["relation_profile_name"],
        "relation_profile_type": relation_payload["relation_profile_type"],
        "storage_batch_id": submission.storage_batch_id,
        "has_text": submission.has_text,
        "has_audio": submission.has_audio,
        "has_image": submission.has_image,
        "has_video": submission.has_video,
        "text_paths": list(submission.text_paths or []),
        "audio_paths": list(submission.audio_paths or []),
        "image_paths": list(submission.image_paths or []),
        "video_paths": list(submission.video_paths or []),
        "text_content": submission.text_content,
        "created_at": submission.created_at,
        "updated_at": submission.updated_at,
    }


def _build_submission_snapshot(
    db: Session,
    submission: DetectionSubmission,
    *,
    viewer_user_id: uuid.UUID,
    latest_job: DetectionJob | None = None,
    latest_result: DetectionResult | None = None,
) -> dict[str, Any]:
    preview = _strip(submission.text_content)
    if len(preview) > 88:
        preview = preview[:88].rstrip() + "…"
    if not preview:
        attachment_parts: list[str] = []
        if submission.text_paths:
            attachment_parts.append(f"文本 {len(submission.text_paths)}")
        if submission.image_paths:
            attachment_parts.append(f"图片 {len(submission.image_paths)}")
        if submission.audio_paths:
            attachment_parts.append(f"音频 {len(submission.audio_paths)}")
        if submission.video_paths:
            attachment_parts.append(f"视频 {len(submission.video_paths)}")
        preview = " / ".join(attachment_parts) if attachment_parts else None

    viewer = user_repository.get_by_id(db, viewer_user_id)
    return {
        "submission": build_submission_payload(db, submission),
        "latest_job": _build_job_snapshot(latest_job, latest_result) if latest_job is not None else None,
        "latest_result": _build_result_snapshot(latest_result),
        "guardian_event_summary": guardian_service.get_submission_event_summary_for_viewer(
            db,
            user_id=viewer_user_id,
            phone=viewer.phone if viewer is not None else "",
            submission_id=submission.id,
        ),
        "content_preview": preview,
    }


def _job_profile_for_submission(submission: DetectionSubmission) -> tuple[str, str, str | None]:
    if submission.audio_paths and not _strip(submission.text_content) and not submission.image_paths and not submission.video_paths:
        return "audio_verify", "audio", _AUDIO_VERIFY_MODEL_LABEL
    if submission.video_paths and not _strip(submission.text_content) and not submission.image_paths and not submission.audio_paths:
        return "video_ai", "video", _VIDEO_AI_MODEL_LABEL
    if settings.agent_enabled and (submission.image_paths or submission.audio_paths or submission.video_paths):
        active_modalities = [
            name
            for name, enabled in (
                ("text", bool(_strip(submission.text_content))),
                ("image", bool(submission.image_paths)),
                ("audio", bool(submission.audio_paths)),
                ("video", bool(submission.video_paths)),
            )
            if enabled
        ]
        input_modality = "multimodal" if len(active_modalities) > 1 else (active_modalities[0] if active_modalities else "multimodal")
        return "agent_multimodal", input_modality, settings.agent_model
    if _strip(submission.text_content):
        return "text_rag", "text", settings.detection_llm_model
    if submission.image_paths:
        return "image_fraud", "image", "resnet18-imagebank"
    return "attachment_only", "attachment_only", None


def _resolve_requested_deep_reasoning(
    *,
    job_type: str,
    input_modality: str,
    requested: bool | None,
) -> bool:
    if isinstance(requested, bool):
        return requested
    return job_type == "text_rag" and input_modality == "text"


def _should_process_inline(job: DetectionJob) -> bool:
    return job.job_type in {"image_fraud", "attachment_only"}


def _should_use_agent_pipeline(submission: DetectionSubmission) -> bool:
    return bool(settings.agent_enabled and (submission.image_paths or submission.audio_paths or submission.video_paths))


def _load_agent_service():
    from app.domain.agent import service as agent_service

    return agent_service


def _normalize_object_list(value: Any, *, text_key: str = "text", reason_key: str = "reason") -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            normalized.append(item)
            continue
        text = _strip(str(item))
        if text:
            normalized.append({text_key: text, reason_key: ""})
    return normalized


def _build_agent_result_detail(analysis: dict[str, Any]) -> dict[str, Any]:
    result_detail = analysis.get("result_detail")
    normalized_detail = dict(result_detail) if isinstance(result_detail, dict) else {}
    normalized_detail["agent_summary"] = {
        "risk_score": analysis.get("risk_score"),
        "risk_labels": list(analysis.get("risk_labels") or []),
        "skills_triggered": list(analysis.get("skills_triggered") or []),
        "evidence": _normalize_object_list(analysis.get("evidence")),
        "recommendations": list(analysis.get("recommendations") or []),
        "retrieval_query": analysis.get("retrieval_query"),
        "rule_score": analysis.get("rule_score"),
    }
    return normalized_detail


def _resolve_agent_rule_score(analysis: dict[str, Any], result_detail: dict[str, Any]) -> int:
    final_score = result_detail.get("final_score")
    if isinstance(final_score, (int, float)):
        return max(0, min(100, round(float(final_score))))
    risk_score = analysis.get("risk_score")
    if isinstance(risk_score, (int, float)):
        numeric = float(risk_score)
        if numeric <= 1:
            numeric *= 100
        return max(0, min(100, round(numeric)))
    return 0


def _build_agent_result_row(
    *,
    submission: DetectionSubmission,
    job: DetectionJob,
    analysis: dict[str, Any],
) -> DetectionResult:
    result_detail = _build_agent_result_detail(analysis)
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=_strip(str(analysis.get("risk_level") or "")) or "low",
        fraud_type=_strip(str(analysis.get("fraud_type") or "")) or None,
        confidence=float(analysis.get("confidence") or 0.0),
        is_fraud=bool(analysis.get("is_fraud")),
        summary=_strip(str(analysis.get("summary") or "")) or "检测完成",
        final_reason=_strip(str(analysis.get("final_reason") or "")) or None,
        need_manual_review=bool(analysis.get("need_manual_review")),
        stage_tags=[str(item).strip() for item in list(analysis.get("stage_tags") or []) if str(item).strip()],
        hit_rules=[str(item).strip() for item in list(analysis.get("hit_rules") or []) if str(item).strip()],
        rule_hits=_normalize_object_list(analysis.get("rule_hits")),
        extracted_entities=dict(analysis.get("extracted_entities") or {}),
        input_highlights=_normalize_object_list(analysis.get("input_highlights")),
        retrieved_evidence=_normalize_object_list(analysis.get("retrieved_evidence")),
        counter_evidence=_normalize_object_list(analysis.get("counter_evidence")),
        advice=[str(item).strip() for item in list(analysis.get("advice") or analysis.get("recommendations") or []) if str(item).strip()],
        llm_model=_strip(str(analysis.get("llm_model") or "")) or None,
        result_detail=result_detail,
    )


def _normalize_agent_trace(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        action_name = _strip(str(item.get("action") or item.get("key") or ""))
        if not action_name:
            continue
        iteration_raw = item.get("iteration")
        iteration = (
            int(iteration_raw)
            if isinstance(iteration_raw, int)
            else int(float(iteration_raw))
            if isinstance(iteration_raw, (float, str)) and str(iteration_raw).strip()
            else index
        )
        normalized.append(
            {
                "id": _strip(str(item.get("id") or "")) or f"agent-step-{index}:{action_name}",
                "action": action_name,
                "key": action_name,
                "label": _strip(str(item.get("label") or "")) or action_label(action_name),
                "status": _strip(str(item.get("status") or "")) or "pending",
                "iteration": iteration,
            }
        )
    return normalized


def _estimate_agent_progress_percent(progress_event: dict[str, Any]) -> int:
    trace = _normalize_agent_trace(progress_event.get("execution_trace"))
    completed_count = sum(1 for item in trace if item.get("status") == "completed")
    running_count = sum(1 for item in trace if item.get("status") == "running")
    selected_count = len([item for item in list(progress_event.get("selected_skills") or []) if _strip(str(item))])
    followup_count = len([item for item in list(progress_event.get("followup_actions") or []) if _strip(str(item))])
    pending_count = len([item for item in list(progress_event.get("pending_actions") or []) if _strip(str(item))])
    total_count = max(1, selected_count + followup_count + 1, completed_count + running_count + pending_count)
    progress_units = completed_count + (0.55 if running_count else 0.0)
    ratio = min(1.0, progress_units / total_count)
    return max(58, min(96, 58 + round(ratio * 38)))


def _build_agent_progress_extra(
    *,
    submission: DetectionSubmission,
    input_modality: str,
    progress_event: dict[str, Any],
) -> dict[str, Any]:
    trace = _normalize_agent_trace(progress_event.get("execution_trace"))
    used_modules: list[str] = []
    reasoning_path: list[str] = []
    for item in trace:
        action_name = _strip(str(item.get("action") or item.get("key") or ""))
        label = _strip(str(item.get("label") or ""))
        if action_name and action_name not in used_modules:
            used_modules.append(action_name)
        if label and label not in reasoning_path:
            reasoning_path.append(label)

    current_action = _strip(str(progress_event.get("current_action") or "")) or None
    return {
        "submission_id": str(submission.id),
        "input_modality": input_modality,
        "agent_phase": _strip(str(progress_event.get("phase") or "")) or None,
        "current_action": current_action,
        "current_action_label": action_label(current_action) if current_action else None,
        "used_modules": used_modules,
        "execution_trace": trace,
        "module_trace": trace,
        "reasoning_path": reasoning_path,
        "execution_plan": list(progress_event.get("execution_plan") or []),
        "selected_skills": [str(item).strip() for item in list(progress_event.get("selected_skills") or []) if str(item).strip()],
        "pending_actions": [str(item).strip() for item in list(progress_event.get("pending_actions") or []) if str(item).strip()],
        "completed_actions": [str(item).strip() for item in list(progress_event.get("completed_actions") or []) if str(item).strip()],
        "followup_actions": [str(item).strip() for item in list(progress_event.get("followup_actions") or []) if str(item).strip()],
        "iteration_count": progress_event.get("iteration_count"),
        "max_iterations": progress_event.get("max_iterations"),
        "requires_followup": bool(progress_event.get("requires_followup")),
        "stop_reason": progress_event.get("stop_reason"),
    }


def _resolve_submission_upload_path(relative_path: str) -> Path:
    upload_root = resolved_upload_root(settings.upload_root)
    return (upload_root / relative_path).resolve()


def resolve_owned_audio_upload_file(
    db: Session,
    *,
    user_id: uuid.UUID,
    audio_path: str,
) -> Path:
    selected_path = _normalize_requested_paths([audio_path])[0]
    _resolve_audio_upload_rows_for_paths(
        db,
        user_id=user_id,
        audio_paths=[selected_path],
    )

    upload_root = resolved_upload_root(settings.upload_root).resolve()
    full_path = (upload_root / selected_path).resolve()
    try:
        full_path.relative_to(upload_root)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="音频路径无效") from exc

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="音频文件不存在")

    return full_path


def _build_reference_image_url(raw_path: str) -> str | None:
    repo_root = Path(__file__).resolve().parents[4]

    reference_root = Path(settings.image_fraud_reference_dir).expanduser()
    if not reference_root.is_absolute():
        reference_root = (repo_root / reference_root).resolve()
    else:
        reference_root = reference_root.resolve()

    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = (repo_root / candidate).resolve()
    else:
        candidate = candidate.resolve()

    try:
        relative_path = candidate.relative_to(reference_root).as_posix()
    except ValueError:
        relative_path = candidate.name.strip()

    if not relative_path:
        return None

    return f"/reference-images/{quote(relative_path, safe='/')}"


def _score_to_percent(value: float) -> int:
    return max(0, min(100, round(float(value) * 100)))


def _build_image_reasoning_graph(
    best_check: image_fraud_service.ImageFraudCheckResult,
    *,
    image_count: int,
    suspicious_count: int,
) -> dict[str, Any]:
    match_nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    if best_check.risk_level != "low":
        for index, match in enumerate(best_check.matches[:2]):
            node_id = f"match:{index}"
            match_nodes.append(
                {
                    "id": node_id,
                    "label": f"相似样本 {match.rank}",
                    "kind": "risk_basis",
                    "tone": "danger",
                    "lane": 1,
                    "order": index,
                    "strength": max(0.46, min(0.92, match.similarity)),
                    "meta": {
                        "sample": match.label,
                        "similarity": _score_to_percent(match.similarity),
                    },
                }
            )
            edges.append(
                {
                    "id": f"edge:input:{node_id}",
                    "source": "input",
                    "target": node_id,
                    "tone": "danger",
                    "kind": "reasoning",
                    "weight": max(0.44, min(0.9, match.similarity)),
                }
            )
            edges.append(
                {
                    "id": f"edge:{node_id}:decision",
                    "source": node_id,
                    "target": "decision",
                    "tone": "danger",
                    "kind": "decision_support",
                    "weight": max(0.42, min(0.88, match.similarity)),
                }
            )

    if best_check.risk_level == "low":
        match_nodes.append(
            {
                "id": "guard",
                "label": "低于阈值",
                "kind": "counter_basis",
                "tone": "safe",
                "lane": 2,
                "order": 0,
                "strength": 0.62,
                "meta": {
                    "review_threshold": _score_to_percent(best_check.review_threshold),
                },
            }
        )
        edges.extend(
            [
                {
                    "id": "edge:input:guard",
                    "source": "input",
                    "target": "guard",
                    "tone": "safe",
                    "kind": "counter_basis",
                    "weight": 0.58,
                },
                {
                    "id": "edge:guard:decision",
                    "source": "guard",
                    "target": "decision",
                    "tone": "safe",
                    "kind": "decision_balance",
                    "weight": 0.56,
                },
            ]
        )

    decision_label = "高风险" if best_check.risk_level == "high" else "需复核" if best_check.risk_level == "medium" else "低风险"
    highlighted_path = ["input"]
    if best_check.risk_level == "low" and any(node["id"] == "guard" for node in match_nodes):
        highlighted_path.extend(["guard", "decision"])
    elif match_nodes:
        highlighted_path.extend([match_nodes[0]["id"], "decision"])
    else:
        highlighted_path.append("decision")

    nodes = [
        {
            "id": "input",
            "label": "截图输入",
            "kind": "input",
            "tone": "primary",
            "lane": 0,
            "order": 0,
            "strength": 0.72,
            "meta": {
                "image_count": image_count,
                "suspicious_count": suspicious_count,
            },
        },
        *match_nodes,
        {
            "id": "decision",
            "label": decision_label,
            "kind": "risk",
            "tone": "danger" if best_check.risk_level != "low" else "safe",
            "lane": 3,
            "order": 0,
            "strength": max(0.4, min(0.96, best_check.score)),
            "meta": {
                "score": _score_to_percent(best_check.score),
                "max_similarity": _score_to_percent(best_check.max_similarity),
            },
        },
    ]
    label_lookup = {node["id"]: node["label"] for node in nodes}
    return {
        "nodes": nodes,
        "edges": edges,
        "highlighted_path": highlighted_path,
        "highlighted_labels": [label_lookup[item] for item in highlighted_path if item in label_lookup],
        "summary_metrics": {
            "risk_basis_count": len(best_check.matches[:2]) if best_check.risk_level != "low" else 0,
            "counter_basis_count": 1 if best_check.risk_level == "low" else 0,
            "signal_count": suspicious_count,
            "image_count": image_count,
            "final_score": _score_to_percent(best_check.score),
        },
    }


def _build_image_evidence_items(
    best_check: image_fraud_service.ImageFraudCheckResult,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if best_check.risk_level == "low":
        return (
            [],
            [
                {
                    "source_id": 0,
                    "chunk_index": 0,
                    "sample_label": "white",
                    "fraud_type": "未命中诈骗截图库",
                    "data_source": "图片相似库",
                    "url": None,
                    "chunk_text": f"最高综合分 {_score_to_percent(best_check.score)}，低于疑似阈值 {_score_to_percent(best_check.review_threshold)}。",
                    "similarity_score": best_check.score,
                    "match_source": "image_similarity",
                    "reason": "当前图片与诈骗样本整体差异较大。",
                }
            ],
        )

    retrieved = [
        {
            "source_id": index,
            "chunk_index": index,
            "sample_label": "black",
            "fraud_type": match.label,
            "data_source": "图片相似库",
            "url": _build_reference_image_url(match.path),
            "chunk_text": f"{match.label} · 相似度 {_score_to_percent(match.similarity)}",
            "similarity_score": match.similarity,
            "match_source": "image_similarity",
            "reason": match.path,
        }
        for index, match in enumerate(best_check.matches[:3], start=1)
    ]
    return retrieved, []


def _build_image_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    image_checks: list[image_fraud_service.ImageFraudCheckResult] = []
    failed_paths: list[str] = []

    for relative_path in list(submission.image_paths or []):
        full_path = _resolve_submission_upload_path(relative_path)
        try:
            image_checks.append(
                image_fraud_service.check_image_fraud(
                    image_bytes=full_path.read_bytes(),
                    filename=Path(relative_path).name,
                )
            )
        except Exception:  # noqa: BLE001
            failed_paths.append(relative_path)
            logger.exception("图片诈骗检测失败，已跳过: %s", relative_path)

    if not image_checks:
        if failed_paths:
            raise RuntimeError("图片样本读取失败，无法完成图片诈骗检测")
        return _build_attachment_only_result(submission, job)

    image_checks.sort(key=lambda item: item.score, reverse=True)
    best_check = image_checks[0]
    suspicious_count = sum(1 for item in image_checks if item.score >= item.review_threshold)
    retrieved_evidence, counter_evidence = _build_image_evidence_items(best_check)
    match_labels = [item.label for item in best_check.matches[:2]]

    if best_check.risk_level == "high":
        summary = "诈骗截图相似度高"
        final_reason = (
            f"{best_check.filename} 与诈骗样本高度接近，综合分 {_score_to_percent(best_check.score)}，"
            f"最高近邻相似度 {_score_to_percent(best_check.max_similarity)}。"
        )
        advice = ["暂停转账", "改走官方核验", "保留截图证据"]
    elif best_check.risk_level == "medium":
        summary = "疑似诈骗截图"
        final_reason = (
            f"{best_check.filename} 命中诈骗截图库边界区间，综合分 {_score_to_percent(best_check.score)}，"
            f"建议结合 OCR 文本或人工复核继续判断。"
        )
        advice = ["补充 OCR 文本", "人工复核聊天内容", "不要立即操作资金"]
    else:
        summary = "未命中诈骗截图库"
        final_reason = (
            f"{best_check.filename} 的最高综合分为 {_score_to_percent(best_check.score)}，"
            f"低于疑似阈值 {_score_to_percent(best_check.review_threshold)}。"
        )
        advice = ["若仍怀疑，请补充更多截图", "优先核验对方身份", "不要泄露验证码"]

    risk_evidence = [
        f"{match.label} 相似度 {_score_to_percent(match.similarity)}"
        for match in best_check.matches[:3]
    ] if best_check.risk_level != "low" else []
    counter_basis = (
        [f"综合分 {_score_to_percent(best_check.score)} 低于阈值 {_score_to_percent(best_check.review_threshold)}"]
        if best_check.risk_level == "low"
        else []
    )
    reasoning_graph = _build_image_reasoning_graph(
        best_check,
        image_count=len(image_checks),
        suspicious_count=suspicious_count,
    )
    detail = {
        "message": "已执行诈骗图片相似度检测。",
        "used_modules": ["preprocess", "embedding", "vector_retrieval", "graph_reasoning", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "截图编码", "status": "completed"},
            {"key": "vector_retrieval", "label": "相似检索", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "llm_reasoning", "label": "模型判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(best_check.score),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_basis,
        "image_results": [item.as_dict() for item in image_checks[:6]],
        "failed_paths": failed_paths,
        "reference_count": best_check.reference_count,
        "thresholds": {
            "review": best_check.review_threshold,
            "positive": best_check.positive_threshold,
        },
        "base_score": best_check.base_score,
        "feature_penalty": best_check.feature_penalty,
        "visual_stats": best_check.visual_stats,
    }

    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=best_check.risk_level,
        fraud_type="诈骗截图" if best_check.risk_level != "low" else "未命中截图库",
        confidence=best_check.confidence,
        is_fraud=best_check.is_fraud,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=best_check.need_manual_review,
        stage_tags=["图片相似检索", "诈骗截图比对"],
        hit_rules=["诈骗截图库命中"] if best_check.risk_level != "low" else [],
        rule_hits=[
            {
                "name": "诈骗截图相似度",
                "category": "image_similarity",
                "risk_points": _score_to_percent(best_check.score),
                "explanation": "上传图片与诈骗样本库存在视觉相似性。",
                "matched_texts": match_labels,
                "stage_tag": "图片相似检索",
                "fraud_type_hint": "诈骗截图" if best_check.risk_level != "low" else None,
            }
        ] if best_check.risk_level != "low" else [],
        extracted_entities={
            "image_count": len(image_checks),
            "suspicious_count": suspicious_count,
            "best_image": best_check.filename,
            "best_score": best_check.score,
            "best_similarity": best_check.max_similarity,
        },
        input_highlights=[
            {
                "text": best_check.filename,
                "reason": f"综合分 {_score_to_percent(best_check.score)}",
            }
        ],
        retrieved_evidence=retrieved_evidence,
        counter_evidence=counter_evidence,
        advice=advice,
        llm_model=best_check.model_name,
        result_detail=detail,
    )


def _build_audio_reasoning_graph(
    *,
    file_name: str,
    fake_prob: float,
    risk_level: str,
    suspicious_count: int,
    total_count: int,
) -> dict[str, Any]:
    verdict_label = "疑似 AI 合成" if risk_level != "low" else "真人概率更高"
    return {
        "nodes": [
            {
                "id": "audio_input",
                "label": file_name,
                "kind": "input",
                "tone": "primary",
                "lane": 0,
                "order": 0,
                "strength": 0.72,
                "meta": {"count": total_count},
            },
            {
                "id": "audio_feature",
                "label": "声纹特征",
                "kind": "signal",
                "tone": "info",
                "lane": 1,
                "order": 0,
                "strength": max(0.22, fake_prob),
                "meta": {
                    "fake_prob": _score_to_percent(fake_prob),
                    "suspicious_count": suspicious_count,
                },
            },
            {
                "id": "audio_verdict",
                "label": verdict_label,
                "kind": "decision",
                "tone": "danger" if risk_level != "low" else "success",
                "lane": 2,
                "order": 0,
                "strength": max(0.28, fake_prob),
                "meta": {"risk_level": risk_level},
            },
        ],
        "edges": [
            {
                "id": "edge:audio_input:audio_feature",
                "source": "audio_input",
                "target": "audio_feature",
                "tone": "info",
                "kind": "reasoning",
                "weight": 0.64,
            },
            {
                "id": "edge:audio_feature:audio_verdict",
                "source": "audio_feature",
                "target": "audio_verdict",
                "tone": "danger" if risk_level != "low" else "success",
                "kind": "decision",
                "weight": max(0.42, fake_prob),
            },
        ],
        "highlighted_path": ["audio_input", "audio_feature", "audio_verdict"],
        "highlighted_labels": [file_name, "声纹特征", verdict_label],
        "summary_metrics": {
            "total_count": total_count,
            "suspicious_count": suspicious_count,
            "max_fake_prob": _score_to_percent(fake_prob),
        },
    }


def _build_audio_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    audio_detector_module = _load_audio_detector_module()
    audio_items: list[dict[str, Any]] = []
    failed_items: list[dict[str, str | None]] = []

    for relative_path in list(submission.audio_paths or []):
        file_name = Path(relative_path).name
        full_path = _resolve_submission_upload_path(relative_path)
        try:
            result = audio_detector_module.predict_file(str(full_path))
        except Exception as exc:  # noqa: BLE001
            failed_items.append(
                {
                    "file_path": relative_path,
                    "file_name": file_name,
                    "status": "failed",
                    "error_message": str(exc),
                }
            )
            logger.exception("AI 语音合成识别失败，已跳过: %s", relative_path)
            continue

        audio_items.append(
            {
                "file_path": relative_path,
                "file_name": file_name,
                "status": "completed",
                "error_message": None,
                **result,
            }
        )

    if not audio_items:
        raise RuntimeError("音频样本读取失败，无法完成 AI 语音合成识别")

    audio_items.sort(key=lambda item: float(item.get("fake_prob") or 0), reverse=True)
    best_item = audio_items[0]
    suspicious_items = [item for item in audio_items if str(item.get("label")) == "fake"]
    suspicious_count = len(suspicious_items)
    max_fake_prob = float(best_item.get("fake_prob") or 0)
    best_file_name = str(best_item.get("file_name") or "音频")

    if max_fake_prob >= 0.8:
        risk_level = "high"
        summary = "疑似 AI 语音合成"
        final_reason = f"{best_file_name} 的合成概率达到 {_score_to_percent(max_fake_prob)}，建议停止依赖该语音直接做决定。"
        advice = ["回拨本人核验", "不要直接转账", "保留录音证据"]
    elif suspicious_count > 0 or max_fake_prob >= 0.5:
        risk_level = "medium"
        summary = "存在 AI 语音合成风险"
        final_reason = f"{best_file_name} 呈现较高合成特征，最高合成概率 {_score_to_percent(max_fake_prob)}，建议继续人工核验。"
        advice = ["通过视频或原号码复核", "先核对身份", "不要透露验证码"]
    else:
        risk_level = "low"
        summary = "真人语音概率更高"
        final_reason = f"{best_file_name} 的真人概率更高，当前未发现明显 AI 合成特征。"
        advice = ["仍需结合上下文判断", "继续核验转账对象", "保留关键沟通记录"]

    is_fraud = risk_level in {"high", "medium"}
    confidence = max_fake_prob if is_fraud else float(best_item.get("genuine_prob") or 0)
    reasoning_graph = _build_audio_reasoning_graph(
        file_name=best_file_name,
        fake_prob=max_fake_prob,
        risk_level=risk_level,
        suspicious_count=suspicious_count,
        total_count=len(audio_items),
    )
    risk_evidence = [
        f"{item.get('file_name')}: 合成概率 {_score_to_percent(float(item.get('fake_prob') or 0) )}"
        for item in audio_items[:3]
        if float(item.get("fake_prob") or 0) >= 0.5
    ]
    counter_evidence = (
        [
            f"{best_file_name}: 真人概率 {_score_to_percent(float(best_item.get('genuine_prob') or 0))}"
        ]
        if risk_level == "low"
        else []
    )
    detail = {
        "message": "已完成 AI 语音合成识别。",
        "used_modules": ["preprocess", "embedding", "graph_reasoning", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "声纹特征", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "llm_reasoning", "label": "模型判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(max_fake_prob),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_evidence,
        "audio_verify_items": audio_items + failed_items,
        "failed_items": failed_items,
        "suspicious_count": suspicious_count,
        "total_count": len(audio_items),
        "model_version": best_item.get("model_version"),
    }

    hit_rules = ["AI语音合成命中"] if is_fraud else []
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=risk_level,
        fraud_type="AI语音合成" if is_fraud else "真人语音",
        confidence=confidence,
        is_fraud=is_fraud,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=["音频鉴伪", "AI语音识别"],
        hit_rules=hit_rules,
        rule_hits=[
            {
                "name": "AI语音合成识别",
                "category": "audio_verify",
                "risk_points": _score_to_percent(max_fake_prob),
                "explanation": "上传音频已完成 AI 合成概率识别。",
                "matched_texts": [best_file_name],
                "stage_tag": "音频鉴伪",
                "fraud_type_hint": "AI语音合成" if is_fraud else None,
            }
        ],
        extracted_entities={
            "audio_count": len(audio_items),
            "suspicious_count": suspicious_count,
            "top_audio": best_file_name,
            "max_fake_probability": max_fake_prob,
        },
        input_highlights=[
            {
                "text": best_file_name,
                "reason": f"合成概率 {_score_to_percent(max_fake_prob)}",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=str(best_item.get("model_version") or _AUDIO_VERIFY_MODEL_LABEL),
        result_detail=detail,
    )


def _video_ai_rule_name(pattern: str | None) -> str:
    return {
        "oversmooth_ai": "视频时序过度平滑",
        "physical_normal": "视频时序落在真实区间",
        "unstable_review": "视频时序波动偏高",
        "temporal_collapse_ai": "视频时序崩坏/闪烁",
    }.get(_strip(pattern), "视频时序异常")


def _soft_video_behavior_risk(level: str | None) -> str:
    normalized = _strip(level).lower()
    if normalized == "high":
        return "medium"
    if normalized == "medium":
        return "medium"
    return "low"


def _video_behavior_rule_name(level: str | None) -> str:
    return {
        "high": "视频行为/生理波动明显",
        "medium": "视频行为/生理波动偏高",
        "low": "视频行为/生理波动平稳",
    }.get(_strip(level).lower(), "视频行为分析")


def _build_video_execution_trace(
    *,
    ai_detection_status: str,
    physiology_status: str,
    final_status: str,
    video_analysis_target: str | None = None,
    video_count: int | None = None,
    d3_summary: dict[str, Any] | None = None,
    behavior_summary: dict[str, Any] | None = None,
    d3_analyzed_count: int | None = None,
    behavior_analyzed_count: int | None = None,
    final_summary: str | None = None,
    final_score: float | int | None = None,
    overall_risk_level: str | None = None,
    fraud_type: str | None = None,
) -> list[dict[str, Any]]:
    target = _normalize_video_analysis_target(video_analysis_target)
    d3_summary = dict(d3_summary or {})
    behavior_summary = dict(behavior_summary or {})

    if d3_analyzed_count is None and d3_summary:
        d3_analyzed_count = int(d3_summary.get("analyzed_count") or 0)
    if behavior_analyzed_count is None and behavior_summary:
        behavior_analyzed_count = int(behavior_summary.get("analyzed_count") or 0)

    suspicious_count = int(d3_summary.get("suspicious_count") or 0) if d3_summary else None
    person_detected_count = int(behavior_summary.get("person_detected_count") or 0) if behavior_summary else None
    skipped_no_face_count = int(behavior_summary.get("skipped_no_face_count") or 0) if behavior_summary else None

    d3_lead = d3_summary.get("lead_item") if isinstance(d3_summary.get("lead_item"), dict) else {}
    behavior_lead = (
        behavior_summary.get("lead_item") if isinstance(behavior_summary.get("lead_item"), dict) else {}
    )
    d3_lead_name = _strip(str(d3_lead.get("file_name") or ""))
    behavior_lead_name = _strip(str(behavior_lead.get("file_name") or ""))
    d3_lead_std = float(d3_lead.get("second_order_std") or 0.0) if d3_lead else 0.0

    ai_summary = _strip(str(d3_summary.get("overall_summary") or ""))
    if not ai_summary:
        if ai_detection_status == "running":
            ai_summary = "正在分析视频时序连续性与异常波动。"
        elif ai_detection_status == "pending":
            ai_summary = "等待启动 AI 视频检测。"
        else:
            ai_summary = "已完成 AI 视频检测。"

    resolved_physiology_status = physiology_status
    if (
        physiology_status == "completed"
        and (behavior_analyzed_count or 0) <= 0
        and (person_detected_count or 0) <= 0
        and (skipped_no_face_count or 0) > 0
    ):
        resolved_physiology_status = "skipped"

    physiology_summary = _strip(str(behavior_summary.get("overall_summary") or ""))
    if not physiology_summary:
        if resolved_physiology_status == "running":
            physiology_summary = "正在检查人脸稳定性、行为波动与非接触心率信号。"
        elif resolved_physiology_status == "pending":
            physiology_summary = (
                "等待启动人物生理特征判断。"
                if target == "physiology"
                else "等待 AI 视频检测完成后，再判断人物生理特征。"
            )
        elif resolved_physiology_status == "skipped":
            physiology_summary = "未检测到稳定人物，已跳过人物生理特征判断。"
        else:
            physiology_summary = "已完成人物生理特征判断。"

    final_summary_text = _strip(final_summary)
    if not final_summary_text:
        if final_status == "running":
            final_summary_text = "正在汇总前两步结果并生成最终判定。"
        elif final_status == "pending":
            final_summary_text = "等待前两步完成后生成最终判定。"
        elif final_status == "failed":
            final_summary_text = "最终判定生成失败。"
        else:
            final_summary_text = "已生成最终判定。"

    ai_metrics: dict[str, Any] = {}
    if video_count is not None:
        ai_metrics["视频数"] = video_count
    if d3_analyzed_count is not None:
        ai_metrics["已分析"] = d3_analyzed_count
    if suspicious_count is not None:
        ai_metrics["异常"] = suspicious_count

    physiology_metrics: dict[str, Any] = {}
    if behavior_analyzed_count is not None:
        physiology_metrics["已分析"] = behavior_analyzed_count
    if person_detected_count is not None:
        physiology_metrics["检出人物"] = person_detected_count
    if skipped_no_face_count is not None:
        physiology_metrics["跳过"] = skipped_no_face_count

    final_metrics: dict[str, Any] = {}
    if final_score is not None:
        final_metrics["风险评分"] = int(round(float(final_score)))

    ai_tags = ["D3时序"]
    if d3_summary:
        ai_tags.append(
            {
                "high": "高风险",
                "medium": "建议复核",
                "low": "时序稳定",
            }.get(_strip(str(d3_summary.get("overall_risk_level") or "")).lower(), "已分析")
        )

    physiology_tags = ["人物状态"]
    if resolved_physiology_status == "skipped":
        physiology_tags.append("未检出稳定人脸")
    elif behavior_summary:
        physiology_tags.append(
            {
                "high": "高波动",
                "medium": "偏高波动",
                "low": "波动平稳",
            }.get(_strip(str(behavior_summary.get("overall_risk_level") or "")).lower(), "已分析")
        )

    final_tags: list[str] = []
    risk_tag = {
        "high": "高风险",
        "medium": "待复核",
        "low": "风险较低",
    }.get(_strip(overall_risk_level).lower())
    if risk_tag:
        final_tags.append(risk_tag)
    if _strip(fraud_type):
        final_tags.append(_strip(fraud_type))

    items: list[dict[str, Any]] = []
    if target != "physiology":
        items.append(
            {
                "key": "video_ai_detection",
                "action": "video_ai_detection",
                "label": "AI视频检测",
                "status": ai_detection_status,
                "summary": ai_summary,
                **({"detail_line": f"{d3_lead_name} · STD {d3_lead_std:.3f}"} if d3_lead_name else {}),
                "tags": ai_tags,
                **({"metrics": ai_metrics} if ai_metrics else {}),
            }
        )
    if target != "ai":
        items.append(
            {
                "key": "video_physiology_judgement",
                "action": "video_physiology_judgement",
                "label": "人物生理特征判断",
                "status": resolved_physiology_status,
                "summary": physiology_summary,
                **({"detail_line": behavior_lead_name} if behavior_lead_name else {}),
                "tags": physiology_tags,
                **({"metrics": physiology_metrics} if physiology_metrics else {}),
            }
        )
    items.append(
        {
            "key": "final_judge",
            "action": "final_judge",
            "label": "最终判定",
            "status": final_status,
            "summary": final_summary_text,
            "tags": final_tags,
            **({"metrics": final_metrics} if final_metrics else {}),
        }
    )
    return items


def _build_video_analysis_modules(
    *,
    batch_result: dict[str, Any] | None = None,
    behavior_result: dict[str, Any] | None = None,
    video_analysis_target: str | None = None,
) -> list[dict[str, Any]]:
    target = _normalize_video_analysis_target(video_analysis_target)
    summary = dict((batch_result or {}).get("summary") or {})
    behavior_summary = dict((behavior_result or {}).get("summary") or {})
    behavior_analyzed_count = int(behavior_summary.get("analyzed_count") or 0)
    modules: list[dict[str, Any]] = []
    if target != "physiology" and batch_result is not None:
        modules.append(
            {
                "key": "d3_temporal",
                "label": "D3 Temporal",
                "status": "completed",
                "metrics": {
                    "analyzed_count": int(summary.get("analyzed_count") or 0),
                    "suspicious_count": int(summary.get("suspicious_count") or 0),
                    "overall_risk_level": _strip(str(summary.get("overall_risk_level") or "")) or "low",
                },
            }
        )
    if target == "physiology":
        modules.append(
            {
                "key": "face_precheck",
                "label": "Face Precheck",
                "status": "completed",
                "metrics": {
                    "person_detected_count": int(behavior_summary.get("precheck_person_detected_count") or 0),
                    "skipped_no_face_count": int(behavior_summary.get("skipped_no_face_count") or 0),
                },
            }
        )
    if target != "ai" and behavior_result is not None:
        modules.append(
            {
                "key": "behavior_rppg",
                "label": "BehaviorRPPG",
                "status": "completed" if behavior_analyzed_count > 0 else "skipped",
                "metrics": {
                    "analyzed_count": behavior_analyzed_count,
                    "person_detected_count": int(behavior_summary.get("person_detected_count") or 0),
                    "skipped_no_face_count": int(behavior_summary.get("skipped_no_face_count") or 0),
                    "overall_risk_level": _strip(str(behavior_summary.get("overall_risk_level") or "")) or "low",
                },
            }
        )
    return modules


def _build_video_reasoning_graph(
    *,
    lead_item: dict[str, Any] | None,
    summary: dict[str, Any],
) -> dict[str, Any]:
    overall_risk = _strip(str(summary.get("overall_risk_level") or "")) or "low"
    total_count = int(summary.get("total_count") or 0)
    suspicious_count = int(summary.get("suspicious_count") or 0)
    std_value = float((lead_item or {}).get("second_order_std") or 0.0)
    pattern = _strip(str((lead_item or {}).get("pattern") or ""))
    verdict_label = "疑似 AI 视频" if overall_risk in {"medium", "high"} else "时序正常"
    tone = "danger" if overall_risk in {"medium", "high"} else "success"
    pattern_label = _video_ai_rule_name(pattern)

    return {
        "nodes": [
            {
                "id": "video_input",
                "label": "视频输入",
                "kind": "input",
                "tone": "primary",
                "lane": 0,
                "order": 0,
                "strength": 0.72,
                "meta": {"count": total_count},
            },
            {
                "id": "video_feature",
                "label": "二阶时序特征",
                "kind": "signal",
                "tone": "info",
                "lane": 1,
                "order": 0,
                "strength": 0.74,
                "meta": {
                    "second_order_std": round(std_value, 4),
                    "pattern": pattern_label,
                    "suspicious_count": suspicious_count,
                },
            },
            {
                "id": "video_verdict",
                "label": verdict_label,
                "kind": "decision",
                "tone": tone,
                "lane": 2,
                "order": 0,
                "strength": max(0.42, float((lead_item or {}).get("confidence") or 0.0)),
                "meta": {"risk_level": overall_risk},
            },
        ],
        "edges": [
            {
                "id": "edge:video_input:video_feature",
                "source": "video_input",
                "target": "video_feature",
                "tone": "info",
                "kind": "reasoning",
                "weight": 0.64,
            },
            {
                "id": "edge:video_feature:video_verdict",
                "source": "video_feature",
                "target": "video_verdict",
                "tone": tone,
                "kind": "decision",
                "weight": max(0.45, float((lead_item or {}).get("confidence") or 0.0)),
            },
        ],
        "highlighted_path": ["video_input", "video_feature", "video_verdict"],
        "highlighted_labels": ["视频输入", "二阶时序特征", verdict_label],
        "summary_metrics": {
            "total_count": total_count,
            "suspicious_count": suspicious_count,
            "second_order_std": round(std_value, 4),
        },
    }


def _build_video_physiology_reasoning_graph(
    *,
    lead_item: dict[str, Any] | None,
    summary: dict[str, Any],
) -> dict[str, Any]:
    overall_risk = _strip(str(summary.get("overall_risk_level") or "")) or "low"
    total_count = int(summary.get("total_count") or 0)
    person_detected_count = int(summary.get("person_detected_count") or 0)
    skipped_no_face_count = int(summary.get("skipped_no_face_count") or 0)
    face_behavior_score = float((lead_item or {}).get("face_behavior_score") or 0.0)
    physiology_score = float((lead_item or {}).get("physiology_score") or 0.0)
    signal_quality = float((lead_item or {}).get("signal_quality") or 0.0)

    if person_detected_count > 0:
        face_gate_label = "稳定人脸"
        signal_label = "行为/生理波动"
        verdict_label = "人物状态异常" if overall_risk in {"medium", "high"} else "人物状态平稳"
        face_gate_tone = "info"
        signal_tone = "warning" if overall_risk in {"medium", "high"} else "info"
        verdict_tone = "danger" if overall_risk in {"medium", "high"} else "success"
        highlighted_labels = ["视频输入", face_gate_label, signal_label, verdict_label]
    else:
        face_gate_label = "未检出稳定人脸"
        signal_label = "条件不足"
        verdict_label = "未生成人脸结果"
        face_gate_tone = "warning"
        signal_tone = "warning"
        verdict_tone = "warning"
        highlighted_labels = ["视频输入", face_gate_label, signal_label, verdict_label]

    lead_strength = max(0.36, float((lead_item or {}).get("confidence") or 0.0))
    return {
        "nodes": [
            {
                "id": "video_input",
                "label": "视频输入",
                "kind": "input",
                "tone": "primary",
                "lane": 0,
                "order": 0,
                "strength": 0.72,
                "meta": {"count": total_count},
            },
            {
                "id": "face_gate",
                "label": face_gate_label,
                "kind": "signal",
                "tone": face_gate_tone,
                "lane": 1,
                "order": 0,
                "strength": 0.68,
                "meta": {
                    "person_detected_count": person_detected_count,
                    "skipped_no_face_count": skipped_no_face_count,
                },
            },
            {
                "id": "physiology_signal",
                "label": signal_label,
                "kind": "signal",
                "tone": signal_tone,
                "lane": 2,
                "order": 0,
                "strength": lead_strength,
                "meta": {
                    "face_behavior_score": round(face_behavior_score, 4),
                    "physiology_score": round(physiology_score, 4),
                    "signal_quality": round(signal_quality, 4),
                },
            },
            {
                "id": "physiology_verdict",
                "label": verdict_label,
                "kind": "decision",
                "tone": verdict_tone,
                "lane": 3,
                "order": 0,
                "strength": lead_strength,
                "meta": {"risk_level": overall_risk},
            },
        ],
        "edges": [
            {
                "id": "edge:video_input:face_gate",
                "source": "video_input",
                "target": "face_gate",
                "tone": face_gate_tone,
                "kind": "reasoning",
                "weight": 0.6,
            },
            {
                "id": "edge:face_gate:physiology_signal",
                "source": "face_gate",
                "target": "physiology_signal",
                "tone": signal_tone,
                "kind": "reasoning",
                "weight": 0.64,
            },
            {
                "id": "edge:physiology_signal:physiology_verdict",
                "source": "physiology_signal",
                "target": "physiology_verdict",
                "tone": verdict_tone,
                "kind": "decision",
                "weight": lead_strength,
            },
        ],
        "highlighted_path": ["video_input", "face_gate", "physiology_signal", "physiology_verdict"],
        "highlighted_labels": highlighted_labels,
        "summary_metrics": {
            "total_count": total_count,
            "person_detected_count": person_detected_count,
            "skipped_no_face_count": skipped_no_face_count,
            "face_behavior_score": round(face_behavior_score, 4),
            "physiology_score": round(physiology_score, 4),
        },
    }


def _load_submission_video_paths(submission: DetectionSubmission) -> list[tuple[str, Path]]:
    pairs: list[tuple[str, Path]] = []
    for relative_path in list(submission.video_paths or []):
        relative = _strip(relative_path)
        if not relative:
            continue
        pairs.append((relative, _resolve_submission_upload_path(relative)))
    return pairs


def _filter_behavior_result_for_face_videos(
    video_pairs: list[tuple[str, Path]],
    face_precheck_result: dict[str, Any],
    behavior_result: dict[str, Any],
) -> dict[str, Any]:
    total_count = len(video_pairs)
    raw_precheck_summary = dict(face_precheck_result.get("summary") or {})
    raw_summary = dict(behavior_result.get("summary") or {})
    precheck_items = [item for item in list(face_precheck_result.get("items") or []) if isinstance(item, dict)]
    precheck_failures = [item for item in list(face_precheck_result.get("failed_items") or []) if isinstance(item, dict)]
    items = [item for item in list(behavior_result.get("items") or []) if isinstance(item, dict)]
    failed_items = [item for item in list(behavior_result.get("failed_items") or []) if isinstance(item, dict)]

    prechecked_paths = {
        _strip(str(item.get("file_path") or ""))
        for item in precheck_items
        if bool(item.get("person_detected")) and _strip(str(item.get("file_path") or ""))
    }
    detected_items = [item for item in items if bool(item.get("person_detected"))]
    detected_paths = {
        _strip(str(item.get("file_path") or ""))
        for item in detected_items
        if _strip(str(item.get("file_path") or ""))
    }
    filtered_failed_items = [
        item
        for item in failed_items
        if _strip(str(item.get("file_path") or "")) in prechecked_paths
    ]
    filtered_failed_items.extend(
        item
        for item in precheck_failures
        if _strip(str(item.get("file_path") or "")) not in {
            _strip(str(existing.get("file_path") or "")) for existing in filtered_failed_items
        }
    )

    lead_item: dict[str, Any] | None = None
    overall_risk = "low"
    for item in detected_items:
        level = _strip(str(item.get("risk_level") or "low")) or "low"
        if _risk_level_rank(level) > _risk_level_rank(overall_risk):
            overall_risk = level
            lead_item = item
    if lead_item is None and detected_items:
        lead_item = detected_items[0]

    skipped_no_face_count = max(total_count - len(prechecked_paths), 0)
    if detected_items:
        overall_summary = (
            _strip(str(raw_summary.get("overall_summary") or ""))
            or f"检测到稳定人脸，已完成人脸行为与 rPPG 辅助分析，共识别 {len(detected_items)} 段有人脸视频。"
        )
    elif prechecked_paths and filtered_failed_items:
        overall_summary = "轻量验脸发现了人脸候选，但行为/rPPG 精检未生成稳定结果，当前仅保留 D3 时序检测。"
    else:
        overall_summary = "未检测到稳定人脸，已跳过行为与 rPPG 分析，仅保留 D3 时序检测结果。"

    return {
        "items": detected_items,
        "failed_items": filtered_failed_items,
        "summary": {
            "model_name": raw_summary.get("model_name") or raw_precheck_summary.get("model_name"),
            "total_count": total_count,
            "analyzed_count": len(detected_items),
            "failed_count": len(filtered_failed_items),
            "person_detected_count": len(detected_items),
            "skipped_no_face_count": skipped_no_face_count,
            "precheck_person_detected_count": len(prechecked_paths),
            "overall_risk_level": overall_risk,
            "overall_summary": overall_summary,
            "lead_item": lead_item,
        },
    }


def _analyze_video_submission(
    submission: DetectionSubmission,
) -> tuple[list[tuple[str, Path]], dict[str, Any], dict[str, Any]]:
    video_pairs = _load_submission_video_paths(submission)
    if not video_pairs:
        raise RuntimeError("当前提交中没有可分析的视频文件")

    d3_started_at = time.perf_counter()
    batch_result = video_ai_service.analyze_video_batch(video_pairs)
    d3_elapsed = time.perf_counter() - d3_started_at
    logger.info(
        "Video pipeline stage finished: submission=%s stage=d3 elapsed=%.2fs videos=%s analyzed=%s failed=%s",
        submission.id,
        d3_elapsed,
        len(video_pairs),
        len(list(batch_result.get("items") or [])),
        len(list(batch_result.get("failed_items") or [])),
    )

    precheck_started_at = time.perf_counter()
    face_precheck_result = video_deception_service.precheck_video_batch(video_pairs)
    precheck_elapsed = time.perf_counter() - precheck_started_at
    logger.info(
        "Video pipeline stage finished: submission=%s stage=face_precheck elapsed=%.2fs videos=%s detected=%s failed=%s",
        submission.id,
        precheck_elapsed,
        len(video_pairs),
        sum(
            1
            for item in list(face_precheck_result.get("items") or [])
            if isinstance(item, dict) and bool(item.get("person_detected"))
        ),
        len(list(face_precheck_result.get("failed_items") or [])),
    )
    prechecked_paths = {
        _strip(str(item.get("file_path") or ""))
        for item in list(face_precheck_result.get("items") or [])
        if isinstance(item, dict) and bool(item.get("person_detected")) and _strip(str(item.get("file_path") or ""))
    }
    face_video_pairs = [
        (source_path, absolute_path)
        for source_path, absolute_path in video_pairs
        if _strip(source_path) in prechecked_paths
    ]
    if face_video_pairs:
        behavior_started_at = time.perf_counter()
        raw_behavior_result = video_deception_service.analyze_video_batch(face_video_pairs)
        behavior_elapsed = time.perf_counter() - behavior_started_at
        logger.info(
            "Video pipeline stage finished: submission=%s stage=behavior elapsed=%.2fs face_videos=%s analyzed=%s failed=%s",
            submission.id,
            behavior_elapsed,
            len(face_video_pairs),
            len(list(raw_behavior_result.get("items") or [])),
            len(list(raw_behavior_result.get("failed_items") or [])),
        )
    else:
        raw_behavior_result = {
            "items": [],
            "failed_items": [],
            "summary": {
                "model_name": video_deception_service.MODEL_LABEL,
                "total_count": 0,
                "analyzed_count": 0,
                "failed_count": 0,
                "person_detected_count": 0,
                "overall_risk_level": "low",
                "overall_summary": "未命中稳定人脸候选，未启动行为与 rPPG 精检。",
                "lead_item": None,
            },
        }
        logger.info(
            "Video pipeline stage skipped: submission=%s stage=behavior reason=no_stable_face_candidate",
            submission.id,
        )
    behavior_result = _filter_behavior_result_for_face_videos(video_pairs, face_precheck_result, raw_behavior_result)
    return video_pairs, batch_result, behavior_result


def _analyze_video_ai_submission(
    submission: DetectionSubmission,
) -> tuple[list[tuple[str, Path]], dict[str, Any]]:
    video_pairs = _load_submission_video_paths(submission)
    if not video_pairs:
        raise RuntimeError("当前提交中没有可分析的视频文件")

    d3_started_at = time.perf_counter()
    batch_result = video_ai_service.analyze_video_batch(video_pairs)
    d3_elapsed = time.perf_counter() - d3_started_at
    logger.info(
        "Video pipeline stage finished: submission=%s stage=d3 elapsed=%.2fs videos=%s analyzed=%s failed=%s",
        submission.id,
        d3_elapsed,
        len(video_pairs),
        len(list(batch_result.get("items") or [])),
        len(list(batch_result.get("failed_items") or [])),
    )
    return video_pairs, batch_result


def _analyze_video_physiology_submission(
    submission: DetectionSubmission,
) -> tuple[list[tuple[str, Path]], dict[str, Any]]:
    video_pairs = _load_submission_video_paths(submission)
    if not video_pairs:
        raise RuntimeError("当前提交中没有可分析的视频文件")

    precheck_started_at = time.perf_counter()
    face_precheck_result = video_deception_service.precheck_video_batch(video_pairs)
    precheck_elapsed = time.perf_counter() - precheck_started_at
    logger.info(
        "Video pipeline stage finished: submission=%s stage=face_precheck elapsed=%.2fs videos=%s detected=%s failed=%s",
        submission.id,
        precheck_elapsed,
        len(video_pairs),
        sum(
            1
            for item in list(face_precheck_result.get("items") or [])
            if isinstance(item, dict) and bool(item.get("person_detected"))
        ),
        len(list(face_precheck_result.get("failed_items") or [])),
    )

    prechecked_paths = {
        _strip(str(item.get("file_path") or ""))
        for item in list(face_precheck_result.get("items") or [])
        if isinstance(item, dict) and bool(item.get("person_detected")) and _strip(str(item.get("file_path") or ""))
    }
    face_video_pairs = [
        (source_path, absolute_path)
        for source_path, absolute_path in video_pairs
        if _strip(source_path) in prechecked_paths
    ]

    if face_video_pairs:
        behavior_started_at = time.perf_counter()
        raw_behavior_result = video_deception_service.analyze_video_batch(face_video_pairs)
        behavior_elapsed = time.perf_counter() - behavior_started_at
        logger.info(
            "Video pipeline stage finished: submission=%s stage=behavior elapsed=%.2fs face_videos=%s analyzed=%s failed=%s",
            submission.id,
            behavior_elapsed,
            len(face_video_pairs),
            len(list(raw_behavior_result.get("items") or [])),
            len(list(raw_behavior_result.get("failed_items") or [])),
        )
    else:
        raw_behavior_result = {
            "items": [],
            "failed_items": [],
            "summary": {
                "model_name": video_deception_service.MODEL_LABEL,
                "total_count": 0,
                "analyzed_count": 0,
                "failed_count": 0,
                "person_detected_count": 0,
                "overall_risk_level": "low",
                "overall_summary": "未命中稳定人脸候选，未启动行为与 rPPG 精检。",
                "lead_item": None,
            },
        }
        logger.info(
            "Video pipeline stage skipped: submission=%s stage=behavior reason=no_stable_face_candidate",
            submission.id,
        )

    behavior_result = _filter_behavior_result_for_face_videos(video_pairs, face_precheck_result, raw_behavior_result)
    return video_pairs, behavior_result


def _append_unique_strings(values: list[str], extra: list[str]) -> list[str]:
    seen = {_strip(item) for item in values if _strip(item)}
    merged = [item for item in values if _strip(item)]
    for item in extra:
        normalized = _strip(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            merged.append(normalized)
    return merged


def _build_image_reasoning_graph(
    best_check: image_fraud_service.ImageFraudCheckResult,
    *,
    image_count: int,
    suspicious_count: int,
) -> dict[str, Any]:
    match_nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    if best_check.risk_level != "low":
        for index, match in enumerate(best_check.matches[:2]):
            node_id = f"match:{index}"
            match_nodes.append(
                {
                    "id": node_id,
                    "label": f"相似样本 {match.rank}",
                    "kind": "risk_basis",
                    "tone": "danger",
                    "lane": 1,
                    "order": index,
                    "strength": max(0.46, min(0.92, match.similarity)),
                    "meta": {
                        "sample": match.label,
                        "similarity": _score_to_percent(match.similarity),
                    },
                }
            )
            edges.append(
                {
                    "id": f"edge:input:{node_id}",
                    "source": "input",
                    "target": node_id,
                    "tone": "danger",
                    "kind": "reasoning",
                    "weight": max(0.44, min(0.9, match.similarity)),
                }
            )
            edges.append(
                {
                    "id": f"edge:{node_id}:decision",
                    "source": node_id,
                    "target": "decision",
                    "tone": "danger",
                    "kind": "decision_support",
                    "weight": max(0.42, min(0.88, match.similarity)),
                }
            )

    if best_check.risk_level == "low":
        match_nodes.append(
            {
                "id": "guard",
                "label": "低于阈值",
                "kind": "counter_basis",
                "tone": "safe",
                "lane": 2,
                "order": 0,
                "strength": 0.62,
                "meta": {
                    "review_threshold": _score_to_percent(best_check.review_threshold),
                },
            }
        )
        edges.extend(
            [
                {
                    "id": "edge:input:guard",
                    "source": "input",
                    "target": "guard",
                    "tone": "safe",
                    "kind": "counter_basis",
                    "weight": 0.58,
                },
                {
                    "id": "edge:guard:decision",
                    "source": "guard",
                    "target": "decision",
                    "tone": "safe",
                    "kind": "decision_balance",
                    "weight": 0.56,
                },
            ]
        )

    decision_label = "高风险" if best_check.risk_level == "high" else "需复核" if best_check.risk_level == "medium" else "低风险"
    highlighted_path = ["input"]
    if best_check.risk_level == "low" and any(node["id"] == "guard" for node in match_nodes):
        highlighted_path.extend(["guard", "decision"])
    elif match_nodes:
        highlighted_path.extend([match_nodes[0]["id"], "decision"])
    else:
        highlighted_path.append("decision")

    nodes = [
        {
            "id": "input",
            "label": "截图输入",
            "kind": "input",
            "tone": "primary",
            "lane": 0,
            "order": 0,
            "strength": 0.72,
            "meta": {
                "image_count": image_count,
                "suspicious_count": suspicious_count,
            },
        },
        *match_nodes,
        {
            "id": "decision",
            "label": decision_label,
            "kind": "risk",
            "tone": "danger" if best_check.risk_level != "low" else "safe",
            "lane": 3,
            "order": 0,
            "strength": max(0.4, min(0.96, best_check.score)),
            "meta": {
                "score": _score_to_percent(best_check.score),
                "max_similarity": _score_to_percent(best_check.max_similarity),
            },
        },
    ]
    label_lookup = {node["id"]: node["label"] for node in nodes}
    return {
        "nodes": nodes,
        "edges": edges,
        "highlighted_path": highlighted_path,
        "highlighted_labels": [label_lookup[item] for item in highlighted_path if item in label_lookup],
        "summary_metrics": {
            "risk_basis_count": len(best_check.matches[:2]) if best_check.risk_level != "low" else 0,
            "counter_basis_count": 1 if best_check.risk_level == "low" else 0,
            "signal_count": suspicious_count,
            "image_count": image_count,
            "final_score": _score_to_percent(best_check.score),
        },
    }


def _build_image_evidence_items(
    best_check: image_fraud_service.ImageFraudCheckResult,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if best_check.risk_level == "low":
        return (
            [],
            [
                {
                    "source_id": 0,
                    "chunk_index": 0,
                    "sample_label": "white",
                    "fraud_type": "未命中诈骗截图库",
                    "data_source": "图片相似库",
                    "url": None,
                    "chunk_text": f"最高综合分 {_score_to_percent(best_check.score)}，低于疑似阈值 {_score_to_percent(best_check.review_threshold)}。",
                    "similarity_score": best_check.score,
                    "match_source": "image_similarity",
                    "reason": "当前图片与诈骗样本整体差异较大。",
                }
            ],
        )

    retrieved = [
        {
            "source_id": index,
            "chunk_index": index,
            "sample_label": "black",
            "fraud_type": match.label,
            "data_source": "图片相似库",
            "url": _build_reference_image_url(match.path),
            "chunk_text": f"{match.label} · 相似度 {_score_to_percent(match.similarity)}",
            "similarity_score": match.similarity,
            "match_source": "image_similarity",
            "reason": match.path,
        }
        for index, match in enumerate(best_check.matches[:3], start=1)
    ]
    return retrieved, [] 


def _is_image_fraud_reference_unavailable(exc: Exception) -> bool:
    message = _strip(str(exc))
    return "诈骗图片目录为空" in message or "诈骗图片样本无法读取" in message


def _build_image_fraud_unavailable_result(
    submission: DetectionSubmission,
    job: DetectionJob,
    *,
    failed_paths: list[str],
    error_message: str,
) -> DetectionResult:
    image_names = [Path(item).name for item in list(submission.image_paths or [])[:3]]
    reasoning_graph = {
        "nodes": [
            {"id": "input", "label": "图片材料", "kind": "input", "tone": "primary", "lane": 0, "order": 0, "strength": 0.6},
            {"id": "index_missing", "label": "样本库缺失", "kind": "signal", "tone": "warning", "lane": 1, "order": 0, "strength": 0.82},
            {"id": "manual_review", "label": "人工复核", "kind": "risk", "tone": "warning", "lane": 2, "order": 0, "strength": 0.76},
        ],
        "edges": [
            {"id": "edge:input:index_missing", "source": "input", "target": "index_missing", "tone": "warning", "kind": "reasoning", "weight": 0.7},
            {"id": "edge:index_missing:manual_review", "source": "index_missing", "target": "manual_review", "tone": "warning", "kind": "decision", "weight": 0.72},
        ],
        "highlighted_path": ["input", "index_missing", "manual_review"],
        "highlighted_labels": ["图片材料", "样本库缺失", "人工复核"],
        "summary_metrics": {
            "image_count": len(submission.image_paths or []),
            "failed_count": len(failed_paths),
        },
    }
    detail = {
        "message": "未完成诈骗图片样本库比对，已转人工复核。",
        "used_modules": ["preprocess", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "截图编码", "status": "skipped", "enabled": False},
            {"key": "vector_retrieval", "label": "相似检索", "status": "skipped", "enabled": False},
            {"key": "graph_reasoning", "label": "风险判断", "status": "skipped", "enabled": False},
            {"key": "llm_reasoning", "label": "模型判别", "status": "skipped", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": 0,
        "failed_paths": failed_paths,
        "error": error_message,
        "reference_dir": settings.image_fraud_reference_dir,
    }
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level="low",
        fraud_type="待人工复核",
        confidence=0.0,
        is_fraud=False,
        summary="诈骗图片样本库未配置，当前无法完成图片诈骗比对。",
        final_reason="系统未找到可用的诈骗截图参考库，已跳过图片样本比对。请先配置参考图片目录后重试，当前结果建议人工复核。",
        need_manual_review=True,
        stage_tags=["图片相似检索", "人工复核"],
        hit_rules=[],
        rule_hits=[],
        extracted_entities={
            "image_count": len(submission.image_paths or []),
            "reference_dir": settings.image_fraud_reference_dir,
        },
        input_highlights=[
            {
                "text": " / ".join(image_names) if image_names else "图片材料",
                "reason": "诈骗截图参考库未配置",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=[
            "请先在 fraud_source/image_fraud 下放入参考诈骗截图",
            "或在 .env 中配置 IMAGE_FRAUD_REFERENCE_DIR",
            "当前结果建议人工复核",
        ],
        llm_model=None,
        result_detail=detail,
    )


def _build_image_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    image_checks: list[image_fraud_service.ImageFraudCheckResult] = []
    failed_paths: list[str] = []
    service_unavailable_error: str | None = None

    for relative_path in list(submission.image_paths or []):
        full_path = _resolve_submission_upload_path(relative_path)
        try:
            image_checks.append(
                image_fraud_service.check_image_fraud(
                    image_bytes=full_path.read_bytes(),
                    filename=Path(relative_path).name,
                )
            )
        except Exception as exc:  # noqa: BLE001
            failed_paths.append(relative_path)
            if _is_image_fraud_reference_unavailable(exc) and service_unavailable_error is None:
                service_unavailable_error = _strip(str(exc))
            logger.exception("图片诈骗检测失败，已跳过: %s", relative_path)

    if not image_checks:
        if service_unavailable_error:
            return _build_image_fraud_unavailable_result(
                submission,
                job,
                failed_paths=failed_paths,
                error_message=service_unavailable_error,
            )
        if failed_paths:
            raise RuntimeError("图片样本读取失败，无法完成图片诈骗检测")
        return _build_attachment_only_result(submission, job)

    image_checks.sort(key=lambda item: item.score, reverse=True)
    best_check = image_checks[0]
    suspicious_count = sum(1 for item in image_checks if item.score >= item.review_threshold)
    retrieved_evidence, counter_evidence = _build_image_evidence_items(best_check)
    match_labels = [item.label for item in best_check.matches[:2]]

    if best_check.risk_level == "high":
        summary = "诈骗截图相似度高"
        final_reason = (
            f"{best_check.filename} 与诈骗样本高度接近，综合分 {_score_to_percent(best_check.score)}，"
            f"最高近邻相似度 {_score_to_percent(best_check.max_similarity)}。"
        )
        advice = ["暂停转账", "改走官方核验", "保留截图证据"]
    elif best_check.risk_level == "medium":
        summary = "疑似诈骗截图"
        final_reason = (
            f"{best_check.filename} 命中诈骗截图库边界区间，综合分 {_score_to_percent(best_check.score)}，"
            f"建议结合 OCR 文本或人工复核继续判断。"
        )
        advice = ["补充 OCR 文本", "人工复核聊天内容", "不要立即操作资金"]
    else:
        summary = "未命中诈骗截图库"
        final_reason = (
            f"{best_check.filename} 的最高综合分为 {_score_to_percent(best_check.score)}，"
            f"低于疑似阈值 {_score_to_percent(best_check.review_threshold)}。"
        )
        advice = ["若仍怀疑，请补充更多截图", "优先核验对方身份", "不要泄露验证码"]

    risk_evidence = [
        f"{match.label} 相似度 {_score_to_percent(match.similarity)}"
        for match in best_check.matches[:3]
    ] if best_check.risk_level != "low" else []
    counter_basis = (
        [f"综合分 {_score_to_percent(best_check.score)} 低于阈值 {_score_to_percent(best_check.review_threshold)}"]
        if best_check.risk_level == "low"
        else []
    )
    reasoning_graph = _build_image_reasoning_graph(
        best_check,
        image_count=len(image_checks),
        suspicious_count=suspicious_count,
    )
    detail = {
        "message": "已执行诈骗图片相似度检测。",
        "used_modules": ["preprocess", "embedding", "vector_retrieval", "graph_reasoning", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "截图编码", "status": "completed"},
            {"key": "vector_retrieval", "label": "相似检索", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "llm_reasoning", "label": "模型判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(best_check.score),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_basis,
        "image_results": [item.as_dict() for item in image_checks[:6]],
        "failed_paths": failed_paths,
        "reference_count": best_check.reference_count,
        "thresholds": {
            "review": best_check.review_threshold,
            "positive": best_check.positive_threshold,
        },
        "base_score": best_check.base_score,
        "feature_penalty": best_check.feature_penalty,
        "visual_stats": best_check.visual_stats,
    }

    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=best_check.risk_level,
        fraud_type="诈骗截图" if best_check.risk_level != "low" else "未命中截图库",
        confidence=best_check.confidence,
        is_fraud=best_check.is_fraud,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=best_check.need_manual_review,
        stage_tags=["图片相似检索", "诈骗截图比对"],
        hit_rules=["诈骗截图库命中"] if best_check.risk_level != "low" else [],
        rule_hits=[
            {
                "name": "诈骗截图相似度",
                "category": "image_similarity",
                "risk_points": _score_to_percent(best_check.score),
                "explanation": "上传图片与诈骗样本库存在视觉相似性。",
                "matched_texts": match_labels,
                "stage_tag": "图片相似检索",
                "fraud_type_hint": "诈骗截图" if best_check.risk_level != "low" else None,
            }
        ] if best_check.risk_level != "low" else [],
        extracted_entities={
            "image_count": len(image_checks),
            "suspicious_count": suspicious_count,
            "best_image": best_check.filename,
            "best_score": best_check.score,
            "best_similarity": best_check.max_similarity,
        },
        input_highlights=[
            {
                "text": best_check.filename,
                "reason": f"综合分 {_score_to_percent(best_check.score)}",
            }
        ],
        retrieved_evidence=retrieved_evidence,
        counter_evidence=counter_evidence,
        advice=advice,
        llm_model=best_check.model_name,
        result_detail=detail,
    )


def _build_audio_reasoning_graph(
    *,
    file_name: str,
    fake_prob: float,
    risk_level: str,
    suspicious_count: int,
    total_count: int,
) -> dict[str, Any]:
    verdict_label = "疑似 AI 合成" if risk_level != "low" else "真人概率更高"
    return {
        "nodes": [
            {
                "id": "audio_input",
                "label": file_name,
                "kind": "input",
                "tone": "primary",
                "lane": 0,
                "order": 0,
                "strength": 0.72,
                "meta": {"count": total_count},
            },
            {
                "id": "audio_feature",
                "label": "声纹特征",
                "kind": "signal",
                "tone": "info",
                "lane": 1,
                "order": 0,
                "strength": max(0.22, fake_prob),
                "meta": {
                    "fake_prob": _score_to_percent(fake_prob),
                    "suspicious_count": suspicious_count,
                },
            },
            {
                "id": "audio_verdict",
                "label": verdict_label,
                "kind": "decision",
                "tone": "danger" if risk_level != "low" else "success",
                "lane": 2,
                "order": 0,
                "strength": max(0.28, fake_prob),
                "meta": {"risk_level": risk_level},
            },
        ],
        "edges": [
            {
                "id": "edge:audio_input:audio_feature",
                "source": "audio_input",
                "target": "audio_feature",
                "tone": "info",
                "kind": "reasoning",
                "weight": 0.64,
            },
            {
                "id": "edge:audio_feature:audio_verdict",
                "source": "audio_feature",
                "target": "audio_verdict",
                "tone": "danger" if risk_level != "low" else "success",
                "kind": "decision",
                "weight": max(0.42, fake_prob),
            },
        ],
        "highlighted_path": ["audio_input", "audio_feature", "audio_verdict"],
        "highlighted_labels": [file_name, "声纹特征", verdict_label],
        "summary_metrics": {
            "total_count": total_count,
            "suspicious_count": suspicious_count,
            "max_fake_prob": _score_to_percent(fake_prob),
        },
    }


def _build_audio_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    audio_detector_module = _load_audio_detector_module()
    audio_items: list[dict[str, Any]] = []
    failed_items: list[dict[str, str | None]] = []

    for relative_path in list(submission.audio_paths or []):
        file_name = Path(relative_path).name
        full_path = _resolve_submission_upload_path(relative_path)
        try:
            result = audio_detector_module.predict_file(str(full_path))
        except Exception as exc:  # noqa: BLE001
            failed_items.append(
                {
                    "file_path": relative_path,
                    "file_name": file_name,
                    "status": "failed",
                    "error_message": str(exc),
                }
            )
            logger.exception("AI 语音合成识别失败，已跳过: %s", relative_path)
            continue

        audio_items.append(
            {
                "file_path": relative_path,
                "file_name": file_name,
                "status": "completed",
                "error_message": None,
                **result,
            }
        )

    if not audio_items:
        raise RuntimeError("音频样本读取失败，无法完成 AI 语音合成识别")

    audio_items.sort(key=lambda item: float(item.get("fake_prob") or 0), reverse=True)
    best_item = audio_items[0]
    suspicious_items = [item for item in audio_items if str(item.get("label")) == "fake"]
    suspicious_count = len(suspicious_items)
    max_fake_prob = float(best_item.get("fake_prob") or 0)
    best_file_name = str(best_item.get("file_name") or "音频")

    if max_fake_prob >= 0.8:
        risk_level = "high"
        summary = "疑似 AI 语音合成"
        final_reason = f"{best_file_name} 的合成概率达到 {_score_to_percent(max_fake_prob)}，建议停止依赖该语音直接做决定。"
        advice = ["回拨本人核验", "不要直接转账", "保留录音证据"]
    elif suspicious_count > 0 or max_fake_prob >= 0.5:
        risk_level = "medium"
        summary = "存在 AI 语音合成风险"
        final_reason = f"{best_file_name} 呈现较高合成特征，最高合成概率 {_score_to_percent(max_fake_prob)}，建议继续人工核验。"
        advice = ["通过视频或原号码复核", "先核对身份", "不要透露验证码"]
    else:
        risk_level = "low"
        summary = "真人语音概率更高"
        final_reason = f"{best_file_name} 的真人概率更高，当前未发现明显 AI 合成特征。"
        advice = ["仍需结合上下文判断", "继续核验转账对象", "保留关键沟通记录"]

    is_fraud = risk_level in {"high", "medium"}
    confidence = max_fake_prob if is_fraud else float(best_item.get("genuine_prob") or 0)
    reasoning_graph = _build_audio_reasoning_graph(
        file_name=best_file_name,
        fake_prob=max_fake_prob,
        risk_level=risk_level,
        suspicious_count=suspicious_count,
        total_count=len(audio_items),
    )
    risk_evidence = [
        f"{item.get('file_name')}: 合成概率 {_score_to_percent(float(item.get('fake_prob') or 0) )}"
        for item in audio_items[:3]
        if float(item.get("fake_prob") or 0) >= 0.5
    ]
    counter_evidence = (
        [
            f"{best_file_name}: 真人概率 {_score_to_percent(float(best_item.get('genuine_prob') or 0))}"
        ]
        if risk_level == "low"
        else []
    )
    detail = {
        "message": "已完成 AI 语音合成识别。",
        "used_modules": ["preprocess", "embedding", "graph_reasoning", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "声纹特征", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "llm_reasoning", "label": "模型判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(max_fake_prob),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_evidence,
        "audio_verify_items": audio_items + failed_items,
        "failed_items": failed_items,
        "suspicious_count": suspicious_count,
        "total_count": len(audio_items),
        "model_version": best_item.get("model_version"),
    }

    hit_rules = ["AI语音合成命中"] if is_fraud else []
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=risk_level,
        fraud_type="AI语音合成" if is_fraud else "真人语音",
        confidence=confidence,
        is_fraud=is_fraud,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=["音频鉴伪", "AI语音识别"],
        hit_rules=hit_rules,
        rule_hits=[
            {
                "name": "AI语音合成识别",
                "category": "audio_verify",
                "risk_points": _score_to_percent(max_fake_prob),
                "explanation": "上传音频已完成 AI 合成概率识别。",
                "matched_texts": [best_file_name],
                "stage_tag": "音频鉴伪",
                "fraud_type_hint": "AI语音合成" if is_fraud else None,
            }
        ],
        extracted_entities={
            "audio_count": len(audio_items),
            "suspicious_count": suspicious_count,
            "top_audio": best_file_name,
            "max_fake_probability": max_fake_prob,
        },
        input_highlights=[
            {
                "text": best_file_name,
                "reason": f"合成概率 {_score_to_percent(max_fake_prob)}",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=str(best_item.get("model_version") or _AUDIO_VERIFY_MODEL_LABEL),
        result_detail=detail,
    )


def _build_video_only_result_from_analysis(
    submission: DetectionSubmission,
    job: DetectionJob,
    *,
    video_pairs: list[tuple[str, Path]],
    batch_result: dict[str, Any],
    behavior_result: dict[str, Any],
) -> DetectionResult:
    summary = dict(batch_result.get("summary") or {})
    items = list(batch_result.get("items") or [])
    failed_items = list(batch_result.get("failed_items") or [])
    behavior_summary = dict(behavior_result.get("summary") or {})
    behavior_items = list(behavior_result.get("items") or [])
    behavior_failed_items = list(behavior_result.get("failed_items") or [])
    if not items:
        raise RuntimeError("视频检测未返回可用结果")

    lead_item = summary.get("lead_item") if isinstance(summary.get("lead_item"), dict) else items[0]
    behavior_lead = behavior_summary.get("lead_item") if isinstance(behavior_summary.get("lead_item"), dict) else (behavior_items[0] if behavior_items else None)
    lead_file_name = _strip(str((lead_item or {}).get("file_name") or "")) or "未命名视频"
    d3_risk = _strip(str(summary.get("overall_risk_level") or "")) or "low"
    behavior_risk = _soft_video_behavior_risk(behavior_summary.get("overall_risk_level"))
    overall_risk = d3_risk if _risk_level_rank(d3_risk) >= _risk_level_rank(behavior_risk) else behavior_risk
    confidence = max(
        float((lead_item or {}).get("confidence") or 0.0),
        float((behavior_lead or {}).get("confidence") or 0.0) * 0.88,
    )
    summary_text = _strip(str(summary.get("overall_summary") or "")) or "已完成视频时序检测。"
    behavior_summary_text = _strip(str(behavior_summary.get("overall_summary") or ""))
    if behavior_summary_text and behavior_summary_text not in summary_text:
        summary_text = f"{summary_text}；{behavior_summary_text}"

    if d3_risk == "high":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序波动明显偏离真实视频分布，疑似存在 AI 生成或强时序篡改痕迹。"
        )
        advice = [
            "优先回看异常时刻附近的原始画面与前后文。",
            "结合关键帧、音频与账号信息交叉核验素材来源。",
            "如涉及转账、身份承诺或诱导操作，先暂停处理并人工复核。",
        ]
    elif overall_risk == "medium":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序特征存在异常，建议结合原片与关键帧进一步复核。"
        )
        advice = [
            "建议人工复核异常时刻与对应画面内容。",
            "对照原始素材、发布时间和上下文信息继续核验。",
            "如用于身份或交易判断，请补充更多证据后再决策。",
        ]
    else:
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序波动整体落在经验真实区间，暂未见明显 AI 时序异常。"
        )
        advice = [
            "当前未见明显时序异常，但仍建议结合素材来源做基础核验。",
            "如后续出现更多异常片段，可重新发起复检。",
        ]

    if behavior_lead and behavior_summary_text and behavior_summary_text not in final_reason:
        final_reason = f"{final_reason} 同时，{behavior_summary_text}"
    if behavior_lead and _risk_level_rank(behavior_risk) >= 2:
        advice = _append_unique_strings(advice, ["结合人脸行为与 rPPG 辅助结果，重点复核异常表情、头动或生理波动。"])

    risk_evidence = [
        f"{_strip(str(item.get('file_name') or '未命名视频'))}: STD {float(item.get('second_order_std') or 0.0):.3f}"
        for item in items[:3]
        if _strip(str(item.get("risk_level") or "")) in {"medium", "high"}
    ]
    if behavior_lead and _risk_level_rank(behavior_risk) >= 2:
        risk_evidence.append(
            f"{_strip(str(behavior_lead.get('file_name') or '未命名视频'))}: 行为分 {float(behavior_lead.get('face_behavior_score') or 0.0):.2f} / 生理分 {float(behavior_lead.get('physiology_score') or 0.0):.2f}"
        )
    counter_basis = (
        [f"{lead_file_name}: STD {float((lead_item or {}).get('second_order_std') or 0.0):.3f}，当前落在经验正常区间"]
        if overall_risk == "low"
        else []
    )
    reasoning_graph = _build_video_reasoning_graph(lead_item=lead_item, summary=summary)
    top_fraud_type = "AI生成视频" if d3_risk in {"medium", "high"} else ("真人状态异常" if behavior_risk in {"medium", "high"} else "视频风险较低")
    detail = {
        "message": "已完成 AI 视频检测、人物生理特征判断与最终判定",
        "video_analysis_target": "combined",
        "used_modules": ["video_ai_detection", "video_physiology_judgement", "final_judge"],
        "module_trace": _build_video_execution_trace(
            ai_detection_status="completed",
            physiology_status="completed",
            final_status="completed",
            video_analysis_target="combined",
            video_count=len(video_pairs),
            d3_summary=summary,
            behavior_summary=behavior_summary,
            final_summary=summary_text,
            final_score=_score_to_percent(confidence),
            overall_risk_level=overall_risk,
            fraud_type=top_fraud_type,
        ),
        "video_analysis_modules": _build_video_analysis_modules(
            batch_result=batch_result,
            behavior_result=behavior_result,
            video_analysis_target="combined",
        ),
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(confidence),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_basis,
        "video_ai_items": items + failed_items,
        "video_ai_summary": summary,
        "video_deception_items": behavior_items + behavior_failed_items,
        "video_deception_summary": behavior_summary,
    }

    is_suspicious = overall_risk in {"medium", "high"}
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=overall_risk,
        fraud_type=top_fraud_type,
        confidence=confidence,
        is_fraud=is_suspicious,
        summary=summary_text,
        final_reason=final_reason,
        need_manual_review=overall_risk == "medium",
        stage_tags=["视频检测", "D3时序检测", "人脸行为分析"],
        hit_rules=["AI视频时序异常"] if d3_risk in {"medium", "high"} else (["人脸行为/生理异常"] if behavior_risk in {"medium", "high"} else []),
        rule_hits=[
            {
                "name": "视频时序异常" if d3_risk in {"medium", "high"} else _video_behavior_rule_name(behavior_risk),
                "category": "video_ai" if d3_risk in {"medium", "high"} else "video_behavior",
                "risk_points": _score_to_percent(confidence),
                "explanation": "基于 D3 时序特征检测到明显异常，视频疑似存在 AI 生成或强篡改痕迹。" if d3_risk in {"medium", "high"} else "检测到一定的人脸行为或生理波动，可作为辅助风险线索。",
                "matched_texts": [lead_file_name],
                "stage_tag": "D3时序检测" if d3_risk in {"medium", "high"} else "人脸行为分析",
                "fraud_type_hint": top_fraud_type if is_suspicious else None,
            }
        ] if is_suspicious else [],
        extracted_entities={
            "video_count": len(items),
            "suspicious_count": int(summary.get("suspicious_count") or 0),
            "top_video": lead_file_name,
            "second_order_std": float((lead_item or {}).get("second_order_std") or 0.0),
            "video_deception": {
                "overall_risk_level": behavior_summary.get("overall_risk_level"),
                "person_detected_count": int(behavior_summary.get("person_detected_count") or 0),
                "top_video": _strip(str((behavior_lead or {}).get("file_name") or "")) or None,
            },
        },
        input_highlights=[
            {
                "text": lead_file_name,
                "reason": f"STD {float((lead_item or {}).get('second_order_std') or 0.0):.3f}",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=_VIDEO_AI_MODEL_LABEL,
        result_detail=detail,
    )


def _build_video_ai_only_result(
    submission: DetectionSubmission,
    job: DetectionJob,
    *,
    video_pairs: list[tuple[str, Path]],
    batch_result: dict[str, Any],
) -> DetectionResult:
    summary = dict(batch_result.get("summary") or {})
    items = [item for item in list(batch_result.get("items") or []) if isinstance(item, dict)]
    failed_items = [item for item in list(batch_result.get("failed_items") or []) if isinstance(item, dict)]
    if not items:
        raise RuntimeError("AI 视频检测未返回可用结果")

    lead_item = summary.get("lead_item") if isinstance(summary.get("lead_item"), dict) else items[0]
    lead_file_name = _strip(str((lead_item or {}).get("file_name") or "")) or "未命名视频"
    risk_level = _strip(str(summary.get("overall_risk_level") or "")) or "low"
    confidence = float((lead_item or {}).get("confidence") or 0.0)
    summary_text = _strip(str(summary.get("overall_summary") or "")) or "已完成 AI 视频检测。"

    if risk_level == "high":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序波动明显偏离真实视频分布，疑似存在 AI 生成或强时序篡改痕迹。"
        )
        advice = [
            "优先回看异常时刻附近的原始画面与前后文。",
            "结合关键帧、音频与账号信息交叉核验素材来源。",
            "如涉及转账、身份承诺或诱导操作，先暂停处理并人工复核。",
        ]
    elif risk_level == "medium":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序特征存在异常，建议结合原片与关键帧进一步复核。"
        )
        advice = [
            "建议人工复核异常时刻与对应画面内容。",
            "对照原始素材、发布时间和上下文信息继续核验。",
            "如用于身份或交易判断，请补充更多证据后再决策。",
        ]
    else:
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的时序波动整体落在经验真实区间，暂未见明显 AI 时序异常。"
        )
        advice = [
            "当前未见明显时序异常，但仍建议结合素材来源做基础核验。",
            "如后续出现更多异常片段，可重新发起复检。",
        ]

    risk_evidence = [
        f"{_strip(str(item.get('file_name') or '未命名视频'))}: STD {float(item.get('second_order_std') or 0.0):.3f}"
        for item in items[:3]
        if _strip(str(item.get("risk_level") or "")) in {"medium", "high"}
    ]
    counter_basis = (
        [f"{lead_file_name}: STD {float((lead_item or {}).get('second_order_std') or 0.0):.3f}，当前落在经验正常区间"]
        if risk_level == "low"
        else []
    )
    reasoning_graph = _build_video_reasoning_graph(lead_item=lead_item, summary=summary)
    fraud_type = "AI生成视频" if risk_level in {"medium", "high"} else "视频风险较低"
    final_score = _score_to_percent(confidence)
    detail = {
        "message": "已完成 AI 视频检测与最终判定",
        "video_analysis_target": "ai",
        "used_modules": ["video_ai_detection", "final_judge"],
        "module_trace": _build_video_execution_trace(
            ai_detection_status="completed",
            physiology_status="pending",
            final_status="completed",
            video_analysis_target="ai",
            video_count=len(video_pairs),
            d3_summary=summary,
            final_summary=summary_text,
            final_score=final_score,
            overall_risk_level=risk_level,
            fraud_type=fraud_type,
        ),
        "video_analysis_modules": _build_video_analysis_modules(
            batch_result=batch_result,
            video_analysis_target="ai",
        ),
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": final_score,
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_basis,
        "video_ai_items": items + failed_items,
        "video_ai_summary": summary,
    }

    is_suspicious = risk_level in {"medium", "high"}
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=risk_level,
        fraud_type=fraud_type,
        confidence=confidence,
        is_fraud=is_suspicious,
        summary=summary_text,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=["视频检测", "AI视频检测"],
        hit_rules=["AI视频时序异常"] if is_suspicious else [],
        rule_hits=[
            {
                "name": "视频时序异常",
                "category": "video_ai",
                "risk_points": final_score,
                "explanation": "基于 D3 时序特征检测到明显异常，视频疑似存在 AI 生成或强篡改痕迹。",
                "matched_texts": [lead_file_name],
                "stage_tag": "AI视频检测",
                "fraud_type_hint": fraud_type,
            }
        ] if is_suspicious else [],
        extracted_entities={
            "video_count": len(items),
            "suspicious_count": int(summary.get("suspicious_count") or 0),
            "top_video": lead_file_name,
            "second_order_std": float((lead_item or {}).get("second_order_std") or 0.0),
        },
        input_highlights=[
            {
                "text": lead_file_name,
                "reason": f"STD {float((lead_item or {}).get('second_order_std') or 0.0):.3f}",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=_VIDEO_AI_MODEL_LABEL,
        result_detail=detail,
    )


def _build_video_physiology_only_result(
    submission: DetectionSubmission,
    job: DetectionJob,
    *,
    video_pairs: list[tuple[str, Path]],
    behavior_result: dict[str, Any],
) -> DetectionResult:
    behavior_summary = dict(behavior_result.get("summary") or {})
    behavior_items = [item for item in list(behavior_result.get("items") or []) if isinstance(item, dict)]
    behavior_failed_items = [item for item in list(behavior_result.get("failed_items") or []) if isinstance(item, dict)]
    lead_item = (
        behavior_summary.get("lead_item")
        if isinstance(behavior_summary.get("lead_item"), dict)
        else (behavior_items[0] if behavior_items else None)
    )

    precheck_person_detected_count = int(behavior_summary.get("precheck_person_detected_count") or 0)
    if not behavior_items and behavior_failed_items and precheck_person_detected_count > 0:
        raise RuntimeError("人物生理特征判断未返回可用结果")

    overall_risk = _strip(str(behavior_summary.get("overall_risk_level") or "")) or "low"
    lead_file_name = _strip(str((lead_item or {}).get("file_name") or "")) or (
        Path(video_pairs[0][0]).name if video_pairs else "未命名视频"
    )
    confidence = float((lead_item or {}).get("confidence") or 0.0)
    summary_text = _strip(str(behavior_summary.get("overall_summary") or "")) or "已完成人物生理特征判断。"
    person_detected_count = int(behavior_summary.get("person_detected_count") or 0)
    skipped_no_face_count = int(behavior_summary.get("skipped_no_face_count") or 0)

    if person_detected_count <= 0:
        final_reason = "未检测到稳定人脸，当前未生成可用的人物行为与生理波动结果。"
        advice = [
            "尽量上传正脸清晰、人物占比更高的视频。",
            "避免强抖动、遮挡或过短片段。",
        ]
    elif overall_risk == "high":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 呈现明显的人物行为或生理异常波动，建议优先人工复核。"
        )
        advice = [
            "重点回看头动、眼神、表情与生理波动异常时刻。",
            "结合原始素材与上下文继续核验人物真实性。",
            "如涉及身份确认或交易指令，先暂停处理。",
        ]
    elif overall_risk == "medium":
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 存在一定的人物行为或生理波动异常，建议进一步复核。"
        )
        advice = [
            "建议结合更多连续片段做复核。",
            "对照说话内容、人物状态和素材来源继续核验。",
        ]
    else:
        final_reason = (
            _strip(str((lead_item or {}).get("final_reason") or ""))
            or f"{lead_file_name} 的人物行为与生理波动整体平稳。"
        )
        advice = [
            "当前未见明显异常，但仍建议结合来源做基础核验。",
        ]

    risk_evidence = []
    if lead_item and person_detected_count > 0:
        risk_evidence.append(
            f"{lead_file_name}: 行为分 {float((lead_item or {}).get('face_behavior_score') or 0.0):.2f} / 生理分 {float((lead_item or {}).get('physiology_score') or 0.0):.2f}"
        )
    counter_basis = ["未检测到稳定人脸，未生成有效人物生理结果。"] if person_detected_count <= 0 else []
    reasoning_graph = _build_video_physiology_reasoning_graph(
        lead_item=lead_item,
        summary=behavior_summary,
    )
    fraud_type = "人物状态异常" if overall_risk in {"medium", "high"} else "人物状态平稳"
    final_score = _score_to_percent(confidence if confidence > 0 else 0.0)
    detail = {
        "message": "已完成人物生理特征判断与最终判定",
        "video_analysis_target": "physiology",
        "used_modules": ["video_physiology_judgement", "final_judge"],
        "module_trace": _build_video_execution_trace(
            ai_detection_status="pending",
            physiology_status="completed",
            final_status="completed",
            video_analysis_target="physiology",
            video_count=len(video_pairs),
            behavior_summary=behavior_summary,
            final_summary=summary_text,
            final_score=final_score,
            overall_risk_level=overall_risk,
            fraud_type=fraud_type,
        ),
        "video_analysis_modules": _build_video_analysis_modules(
            behavior_result=behavior_result,
            video_analysis_target="physiology",
        ),
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": final_score,
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_basis,
        "video_deception_items": behavior_items + behavior_failed_items,
        "video_deception_summary": behavior_summary,
    }

    is_suspicious = overall_risk in {"medium", "high"}
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level=overall_risk,
        fraud_type=fraud_type,
        confidence=confidence if confidence > 0 else 0.0,
        is_fraud=is_suspicious,
        summary=summary_text,
        final_reason=final_reason,
        need_manual_review=overall_risk in {"medium", "high"} or person_detected_count <= 0,
        stage_tags=["视频检测", "人物生理特征判断"],
        hit_rules=["人脸行为/生理异常"] if is_suspicious else [],
        rule_hits=[
            {
                "name": _video_behavior_rule_name(overall_risk),
                "category": "video_behavior",
                "risk_points": final_score,
                "explanation": "检测到一定的人脸行为或生理波动，可作为辅助风险线索。",
                "matched_texts": [lead_file_name],
                "stage_tag": "人物生理特征判断",
                "fraud_type_hint": fraud_type if is_suspicious else None,
            }
        ] if is_suspicious else [],
        extracted_entities={
            "video_count": len(video_pairs),
            "person_detected_count": person_detected_count,
            "skipped_no_face_count": skipped_no_face_count,
            "top_video": lead_file_name,
            "face_behavior_score": float((lead_item or {}).get("face_behavior_score") or 0.0),
            "physiology_score": float((lead_item or {}).get("physiology_score") or 0.0),
            "signal_quality": float((lead_item or {}).get("signal_quality") or 0.0),
        },
        input_highlights=[
            {
                "text": lead_file_name,
                "reason": "稳定人脸" if person_detected_count > 0 else "未检出稳定人脸",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=_VIDEO_PHYSIOLOGY_MODEL_LABEL,
        result_detail=detail,
    )


def _build_video_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    video_pairs, batch_result, behavior_result = _analyze_video_submission(submission)
    return _build_video_only_result_from_analysis(
        submission,
        job,
        video_pairs=video_pairs,
        batch_result=batch_result,
        behavior_result=behavior_result,
    )

def _augment_result_with_video_ai(
    *,
    submission: DetectionSubmission,
    result_row: DetectionResult,
) -> DetectionResult:
    try:
        _, batch_result, behavior_result = _analyze_video_submission(submission)
    except RuntimeError:
        return result_row
    summary = dict(batch_result.get("summary") or {})
    items = list(batch_result.get("items") or [])
    failed_items = list(batch_result.get("failed_items") or [])
    behavior_summary = dict(behavior_result.get("summary") or {})
    behavior_items = list(behavior_result.get("items") or [])
    behavior_failed_items = list(behavior_result.get("failed_items") or [])
    lead_item = summary.get("lead_item") if isinstance(summary.get("lead_item"), dict) else (items[0] if items else None)
    behavior_lead = behavior_summary.get("lead_item") if isinstance(behavior_summary.get("lead_item"), dict) else (behavior_items[0] if behavior_items else None)

    detail = dict(result_row.result_detail or {}) if isinstance(result_row.result_detail, dict) else {}
    detail["video_analysis_target"] = "combined"
    detail["video_ai_items"] = items + failed_items
    detail["video_ai_summary"] = summary
    detail["video_deception_items"] = behavior_items + behavior_failed_items
    detail["video_deception_summary"] = behavior_summary
    detail["video_analysis_modules"] = _build_video_analysis_modules(
        batch_result=batch_result,
        behavior_result=behavior_result,
        video_analysis_target="combined",
    )

    used_modules = [str(item).strip() for item in list(detail.get("used_modules") or []) if str(item).strip()]
    detail["used_modules"] = used_modules

    module_trace = [dict(item) for item in list(detail.get("module_trace") or []) if isinstance(item, dict)]
    detail["module_trace"] = module_trace

    overall_risk = _strip(str(summary.get("overall_risk_level") or ""))
    lead_summary = _strip(str((lead_item or {}).get("summary") or summary.get("overall_summary") or ""))
    lead_reason = _strip(str((lead_item or {}).get("final_reason") or ""))
    lead_file_name = _strip(str((lead_item or {}).get("file_name") or "未命名视频"))
    lead_confidence = float((lead_item or {}).get("confidence") or 0.0)
    lead_std = float((lead_item or {}).get("second_order_std") or 0.0)
    behavior_risk = _soft_video_behavior_risk(behavior_summary.get("overall_risk_level"))
    behavior_confidence = float((behavior_lead or {}).get("confidence") or 0.0)
    behavior_summary_text = _strip(str(behavior_summary.get("overall_summary") or (behavior_lead or {}).get("summary") or ""))

    result_row.stage_tags = _append_unique_strings(list(result_row.stage_tags or []), ["视频检测", "D3时序检测", "人脸行为分析"])
    detail["final_score"] = max(
        float(detail.get("final_score") or 0),
        _score_to_percent(lead_confidence) if lead_item else 0,
        _score_to_percent(behavior_confidence) if behavior_lead else 0,
    )

    if lead_item:
        result_row.input_highlights = list(result_row.input_highlights or [])
        result_row.input_highlights.append(
            {
                "text": lead_file_name,
                "reason": f"视频 STD {lead_std:.3f}",
            }
        )
        extracted_entities = dict(result_row.extracted_entities or {})
        extracted_entities["video_ai"] = {
            "video_count": int(summary.get("analyzed_count") or len(items)),
            "suspicious_count": int(summary.get("suspicious_count") or 0),
            "top_video": lead_file_name,
            "second_order_std": lead_std,
            "overall_risk_level": overall_risk or "low",
        }
        result_row.extracted_entities = extracted_entities

    if behavior_lead:
        extracted_entities = dict(result_row.extracted_entities or {})
        extracted_entities["video_deception"] = {
            "overall_risk_level": behavior_summary.get("overall_risk_level") or "low",
            "person_detected_count": int(behavior_summary.get("person_detected_count") or 0),
            "top_video": _strip(str(behavior_lead.get("file_name") or "未命名视频")),
            "face_behavior_score": float(behavior_lead.get("face_behavior_score") or 0.0),
            "physiology_score": float(behavior_lead.get("physiology_score") or 0.0),
            "signal_quality": float(behavior_lead.get("signal_quality") or 0.0),
        }
        result_row.extracted_entities = extracted_entities
        result_row.advice = _append_unique_strings(
            list(result_row.advice or []),
            ["优先回看异常时刻附近的前后 10 秒原始片段。"],
        )

    if overall_risk in {"medium", "high"} and lead_item:
        result_row.hit_rules = _append_unique_strings(list(result_row.hit_rules or []), ["AI视频时序异常"])
        result_row.rule_hits = list(result_row.rule_hits or [])
        result_row.rule_hits.append(
            {
                "name": "视频时序异常",
                "category": "video_ai",
                "risk_points": _score_to_percent(lead_confidence),
                "explanation": "视频时序特征明显异常，疑似存在 AI 生成或强篡改痕迹。",
                "matched_texts": [lead_file_name],
                "stage_tag": "D3时序检测",
                "fraud_type_hint": "AI生成视频",
            }
        )
        result_row.advice = _append_unique_strings(
            list(result_row.advice or []),
            ["请重点复核异常时刻对应画面。", "结合素材来源与上下文进一步核验。"],
        )
        result_row.need_manual_review = bool(result_row.need_manual_review or overall_risk == "medium")

        current_rank = _risk_level_rank(result_row.risk_level)
        video_rank = _risk_level_rank(overall_risk)
        if video_rank > current_rank:
            result_row.risk_level = overall_risk
            result_row.is_fraud = True
            result_row.confidence = max(float(result_row.confidence or 0.0), lead_confidence)
            result_row.fraud_type = "AI生成视频"
            result_row.summary = lead_summary or result_row.summary
            result_row.final_reason = lead_reason or result_row.final_reason
        else:
            if not result_row.is_fraud:
                result_row.is_fraud = True
            result_row.confidence = max(float(result_row.confidence or 0.0), lead_confidence)
            if lead_summary and lead_summary not in _strip(result_row.summary):
                base_summary = _strip(result_row.summary)
                result_row.summary = f"{base_summary}；补充视频时序检测异常。" if base_summary else lead_summary
            if lead_reason and lead_reason not in _strip(result_row.final_reason):
                base_reason = _strip(result_row.final_reason)
                result_row.final_reason = f"{base_reason}；补充：{lead_reason}" if base_reason else lead_reason

    if behavior_lead and _risk_level_rank(behavior_risk) >= 2:
        result_row.hit_rules = _append_unique_strings(list(result_row.hit_rules or []), ["人脸行为/生理异常"])
        result_row.rule_hits = list(result_row.rule_hits or [])
        result_row.rule_hits.append(
            {
                "name": _video_behavior_rule_name(behavior_risk),
                "category": "video_behavior",
                "risk_points": _score_to_percent(behavior_confidence),
                "explanation": "检测到一定的人脸行为或生理波动，可作为辅助风险线索。",
                "matched_texts": [_strip(str(behavior_lead.get("file_name") or "未命名视频"))],
                "stage_tag": "人脸行为分析",
                "fraud_type_hint": "真人状态异常",
            }
        )
        result_row.need_manual_review = True
        if behavior_summary_text and behavior_summary_text not in _strip(result_row.summary):
            base_summary = _strip(result_row.summary)
            result_row.summary = f"{base_summary}；{behavior_summary_text}" if base_summary else behavior_summary_text
        if behavior_summary_text and behavior_summary_text not in _strip(result_row.final_reason):
            base_reason = _strip(result_row.final_reason)
            result_row.final_reason = f"{base_reason}；补充：{behavior_summary_text}" if base_reason else behavior_summary_text
        result_row.confidence = max(float(result_row.confidence or 0.0), behavior_confidence * 0.88)
        if _risk_level_rank(_soft_video_behavior_risk(behavior_summary.get("overall_risk_level"))) > _risk_level_rank(result_row.risk_level):
            result_row.risk_level = _soft_video_behavior_risk(behavior_summary.get("overall_risk_level"))
            if not _strip(result_row.fraud_type):
                result_row.fraud_type = "真人状态异常"

    result_row.result_detail = detail
    return result_row

def _persist_result_side_effects(
    db: Session,
    *,
    submission: DetectionSubmission,
    result_row: DetectionResult,
) -> None:
    detection_repository.save_result(db, result_row)
    try:
        result_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}
        kag_payload = result_detail.get("kag") if isinstance(result_detail.get("kag"), dict) else None
        storage_snapshot = kag_payload.get("storage_snapshot") if isinstance(kag_payload, dict) else None
        if isinstance(storage_snapshot, dict):
            detection_repository.replace_reasoning_snapshot(
                db,
                submission_id=submission.id,
                result_id=result_row.id,
                snapshot=storage_snapshot,
            )
    except Exception:  # noqa: BLE001
        logger.exception("Reasoning snapshot persistence failed: submission=%s", submission.id)
    try:
        user_profile_memory.refresh_user_profile_from_detection(
            db,
            user_id=submission.user_id,
            submission=submission,
            result=result_row,
        )
    except Exception:  # noqa: BLE001
        logger.exception("User profile refresh failed: submission=%s", submission.id)
    try:
        relation_service.attach_detection_result(
            db,
            user_id=submission.user_id,
            relation_id=submission.relation_profile_id,
            submission_id=submission.id,
            result=result_row,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Relation profile refresh failed: submission=%s", submission.id)
    try:
        guardian_service.maybe_create_events_for_detection_result(
            db,
            submission=submission,
            result=result_row,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Guardian event sync failed: submission=%s", submission.id)


def persist_result_with_side_effects(
    db: Session,
    *,
    submission: DetectionSubmission,
    result_row: DetectionResult,
) -> DetectionResult:
    _persist_result_side_effects(db, submission=submission, result_row=result_row)
    return result_row


def submit_detection(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_root_cfg: str,
    max_upload_bytes: int,
    text_content: str | None,
    relation_profile_id: uuid.UUID | None,
    deep_reasoning: bool | None = None,
    video_analysis_target: str | None = None,
    file_bundles: dict[UploadKind, list[tuple[bytes, str]]],
) -> tuple[DetectionSubmission, DetectionJob]:
    if relation_profile_id is not None:
        relation = relation_repository.get_profile_for_user(
            db,
            user_id=user_id,
            relation_id=relation_profile_id,
        )
        if relation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    submission = create_submission(
        db,
        user_id=user_id,
        upload_root_cfg=upload_root_cfg,
        max_upload_bytes=max_upload_bytes,
        text_content=text_content,
        relation_profile_id=relation_profile_id,
        file_bundles=file_bundles,
    )
    upload_rows = upload_service.sync_submission_uploads(
        db,
        submission_id=submission.id,
        user_id=submission.user_id,
        storage_batch_id=submission.storage_batch_id,
        text_paths=list(submission.text_paths or []),
        audio_paths=list(submission.audio_paths or []),
        image_paths=list(submission.image_paths or []),
        video_paths=list(submission.video_paths or []),
    )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=submission.relation_profile_id,
        submission_id=submission.id,
        text_content=submission.text_content,
        upload_rows=upload_rows,
    )
    job_type, input_modality, llm_model = _job_profile_for_submission(submission)
    resolved_deep_reasoning = _resolve_requested_deep_reasoning(
        job_type=job_type,
        input_modality=input_modality,
        requested=deep_reasoning,
    )
    resolved_video_analysis_target = (
        _normalize_video_analysis_target(video_analysis_target)
        if job_type == "video_ai" and input_modality == "video"
        else None
    )
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type=job_type,
        input_modality=input_modality,
        llm_model=llm_model,
    )
    job = _initialize_job_progress(
        db,
        job,
        extra={
            "analysis_mode": _analysis_mode_value(deep_reasoning=resolved_deep_reasoning),
            "deep_reasoning": resolved_deep_reasoning,
            "analysis_mode_source": _analysis_mode_source(
                requested=deep_reasoning,
                resolved=resolved_deep_reasoning,
            ),
            "video_analysis_target": resolved_video_analysis_target,
        },
    )
    if _should_process_inline(job):
        job = process_job(db, job.id)
    return submission, job


def submit_audio_verify_from_upload_paths(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    audio_paths: list[str],
) -> tuple[DetectionSubmission, DetectionJob]:
    if relation_profile_id is not None:
        relation = relation_repository.get_profile_for_user(
            db,
            user_id=user_id,
            relation_id=relation_profile_id,
        )
        if relation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    selected_paths = _normalize_requested_paths(audio_paths)
    upload_rows = _resolve_audio_upload_rows_for_paths(
        db,
        user_id=user_id,
        audio_paths=selected_paths,
    )

    submission = detection_repository.save_submission(
        db,
        DetectionSubmission(
            user_id=user_id,
            relation_profile_id=relation_profile_id,
            storage_batch_id=_build_reused_storage_batch_id("audio"),
            has_text=False,
            has_audio=True,
            has_image=False,
            has_video=False,
            text_paths=[],
            audio_paths=selected_paths,
            image_paths=[],
            video_paths=[],
            text_content=None,
        ),
    )

    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=submission.relation_profile_id,
        submission_id=submission.id,
        text_content=None,
        upload_rows=_group_upload_rows_by_selected_paths(
            upload_rows=upload_rows,
            selected_paths=selected_paths,
            submission_id=submission.id,
        ),
    )

    job_type, input_modality, llm_model = _job_profile_for_submission(submission)
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type=job_type,
        input_modality=input_modality,
        llm_model=llm_model,
    )
    job = _initialize_job_progress(db, job)
    if _should_process_inline(job):
        job = process_job(db, job.id)
    return submission, job


def list_history(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    offset: int = 0,
    scope: str = "month",
) -> list[dict[str, Any]]:
    normalized_scope = normalize_history_scope(scope)
    start_at, end_at = _history_filter_window(normalized_scope)
    submissions = detection_repository.list_submissions_for_user(
        db,
        user_id=user_id,
        limit=limit,
        offset=offset,
        start_at=start_at,
        end_at=end_at,
    )
    items: list[dict[str, Any]] = []
    for submission in submissions:
        latest_job = detection_repository.get_latest_job_for_submission(db, submission_id=submission.id)
        latest_result = detection_repository.get_latest_result_for_submission(db, submission_id=submission.id)
        items.append(
            _build_submission_snapshot(
                db,
                submission,
                viewer_user_id=user_id,
                latest_job=latest_job,
                latest_result=latest_result,
            )
        )
    return items


def get_history_statistics(
    db: Session,
    *,
    user_id: uuid.UUID,
    scope: str = "month",
) -> dict[str, Any]:
    normalized_scope = normalize_history_scope(scope)
    filter_start_at, filter_end_at = _history_filter_window(normalized_scope)

    total_records = detection_repository.count_submissions_for_user(db, user_id=user_id)
    filtered_total = detection_repository.count_submissions_for_user(
        db,
        user_id=user_id,
        start_at=filter_start_at,
        end_at=filter_end_at,
    )

    filtered_rows = detection_repository.list_submission_risk_rows_for_user(
        db,
        user_id=user_id,
        start_at=filter_start_at,
        end_at=filter_end_at,
    )
    high_count = sum(1 for _, risk_level in filtered_rows if risk_level == "high")
    medium_count = sum(1 for _, risk_level in filtered_rows if risk_level == "medium")
    low_count = sum(1 for _, risk_level in filtered_rows if risk_level == "low")

    analytics_start_at, analytics_end_at = _analytics_window(normalized_scope)
    analytics_rows = detection_repository.list_submission_risk_rows_for_user(
        db,
        user_id=user_id,
        start_at=analytics_start_at,
        end_at=analytics_end_at,
    )

    return {
        "scope": normalized_scope,
        "total_records": total_records,
        "filtered_total": filtered_total,
        "high_count": high_count,
        "medium_count": medium_count,
        "low_count": low_count,
        "points": _build_trend_points(rows=analytics_rows, scope=normalized_scope),
    }


def get_submission_detail(
    db: Session,
    *,
    user_id: uuid.UUID,
    submission_id: uuid.UUID,
) -> dict[str, Any]:
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=submission_id,
        user_id=user_id,
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    latest_job = detection_repository.get_latest_job_for_submission(db, submission_id=submission.id)
    latest_result = detection_repository.get_latest_result_for_submission(db, submission_id=submission.id)
    return _build_submission_snapshot(
        db,
        submission,
        viewer_user_id=user_id,
        latest_job=latest_job,
        latest_result=latest_result,
    )


def get_job_detail(
    db: Session,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    job = detection_repository.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=job.submission_id,
        user_id=user_id,
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    result = detection_repository.get_result_for_job(db, job_id=job.id)
    return _build_job_snapshot(job, result)


def _resolve_submission_deep_reasoning(db: Session, submission: DetectionSubmission) -> bool:
    latest_result = detection_repository.get_latest_result_for_submission(
        db,
        submission_id=submission.id,
    )
    if latest_result is not None and isinstance(latest_result.result_detail, dict):
        result_detail = dict(latest_result.result_detail or {})
        if str(result_detail.get("analysis_mode") or "").strip().lower() == "deep":
            return True
        kag_payload = result_detail.get("kag")
        if isinstance(kag_payload, dict) and str(kag_payload.get("mode") or "").strip().lower() == "deep":
            return True

    latest_job = detection_repository.get_latest_job_for_submission(
        db,
        submission_id=submission.id,
    )
    if _job_uses_deep_reasoning(latest_job):
        return True
    if latest_job is not None:
        progress_detail = dict(latest_job.progress_detail or {})
        if (
            str(progress_detail.get("analysis_mode") or "").strip().lower() == "standard"
            and str(progress_detail.get("analysis_mode_source") or "").strip().lower() == "request"
        ):
            return False

    job_type, input_modality, _ = _job_profile_for_submission(submission)
    return job_type == "text_rag" and input_modality == "text"


def _infer_video_analysis_target_from_result(result: DetectionResult | None) -> str | None:
    if result is None or not isinstance(result.result_detail, dict):
        return None
    detail = dict(result.result_detail or {})
    target = _normalize_video_analysis_target(detail.get("video_analysis_target"))
    if target:
        return target

    has_ai = isinstance(detail.get("video_ai_summary"), dict)
    has_physiology = isinstance(detail.get("video_deception_summary"), dict)
    if has_ai and not has_physiology:
        return "ai"
    if has_physiology and not has_ai:
        return "physiology"
    return None


def _resolve_submission_video_analysis_target(
    db: Session,
    submission: DetectionSubmission,
) -> str | None:
    latest_job = detection_repository.get_latest_job_for_submission(
        db,
        submission_id=submission.id,
    )
    target = _job_video_analysis_target(latest_job)
    if target:
        return target

    latest_result = detection_repository.get_latest_result_for_submission(
        db,
        submission_id=submission.id,
    )
    return _infer_video_analysis_target_from_result(latest_result)


def rerun_submission(
    db: Session,
    *,
    user_id: uuid.UUID,
    submission_id: uuid.UUID,
) -> DetectionJob:
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=submission_id,
        user_id=user_id,
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    if _is_reused_audio_submission(submission):
        upload_rows = _group_upload_rows_by_selected_paths(
            upload_rows=_resolve_audio_upload_rows_for_paths(
                db,
                user_id=submission.user_id,
                audio_paths=list(submission.audio_paths or []),
            ),
            selected_paths=list(submission.audio_paths or []),
            submission_id=submission.id,
        )
    else:
        upload_rows = upload_service.sync_submission_uploads(
            db,
            submission_id=submission.id,
            user_id=submission.user_id,
            storage_batch_id=submission.storage_batch_id,
            text_paths=list(submission.text_paths or []),
            audio_paths=list(submission.audio_paths or []),
            image_paths=list(submission.image_paths or []),
            video_paths=list(submission.video_paths or []),
        )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=submission.relation_profile_id,
        submission_id=submission.id,
        text_content=submission.text_content,
        upload_rows=upload_rows,
    )
    job_type, input_modality, llm_model = _job_profile_for_submission(submission)
    deep_reasoning = _resolve_submission_deep_reasoning(db, submission)
    video_analysis_target = (
        _resolve_submission_video_analysis_target(db, submission)
        if job_type == "video_ai" and input_modality == "video"
        else None
    )
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type=job_type,
        input_modality=input_modality,
        llm_model=llm_model,
    )
    job = _initialize_job_progress(
        db,
        job,
        extra={
            "analysis_mode": _analysis_mode_value(deep_reasoning=deep_reasoning),
            "deep_reasoning": deep_reasoning,
            "video_analysis_target": video_analysis_target,
        },
    )
    if _should_process_inline(job):
        job = process_job(db, job.id)
    return job


def _attachment_only_graph(submission: DetectionSubmission) -> dict[str, Any]:
    attachment_count = len(submission.text_paths or []) + len(submission.audio_paths or []) + len(submission.image_paths or []) + len(submission.video_paths or [])
    return {
        "nodes": [
            {"id": "input", "label": "附件", "kind": "input", "tone": "primary", "lane": 0, "order": 0, "strength": 0.6, "meta": {"count": attachment_count}},
            {"id": "lack_text", "label": "缺少文本", "kind": "signal", "tone": "warning", "lane": 1, "order": 0, "strength": 0.72, "meta": {}},
            {"id": "manual_review", "label": "人工复核", "kind": "risk", "tone": "warning", "lane": 2, "order": 0, "strength": 0.7, "meta": {}},
        ],
        "edges": [
            {"id": "edge:input:lack_text", "source": "input", "target": "lack_text", "tone": "warning", "kind": "reasoning", "weight": 0.64},
            {"id": "edge:lack_text:manual_review", "source": "lack_text", "target": "manual_review", "tone": "warning", "kind": "decision", "weight": 0.68},
        ],
        "highlighted_path": ["input", "lack_text", "manual_review"],
        "highlighted_labels": ["附件", "缺少文本", "人工复核"],
        "summary_metrics": {"attachment_count": attachment_count},
    }


def _build_attachment_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    deep_reasoning = _job_uses_deep_reasoning(job)
    detail = {
        "analysis_mode": _analysis_mode_value(deep_reasoning=deep_reasoning),
        "message": "当前仅上传附件，文本 RAG 尚未获得可直接分析的正文内容。",
        "attachment_counts": {
            "text_files": len(submission.text_paths or []),
            "audio_files": len(submission.audio_paths or []),
            "image_files": len(submission.image_paths or []),
            "video_files": len(submission.video_paths or []),
        },
        "used_modules": ["preprocess", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "清洗", "status": "completed"},
            {"key": "embedding", "label": "编码", "status": "pending"},
            {"key": "vector_retrieval", "label": "召回", "status": "pending"},
            {"key": "graph_reasoning", "label": "图谱", "status": "pending"},
            {"key": "llm_reasoning", "label": "判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": _attachment_only_graph(submission),
        "reasoning_path": ["附件", "缺少文本", "人工复核"],
        "kag": None,
    }
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level="low",
        fraud_type="待人工复核",
        confidence=0.12,
        is_fraud=False,
        summary="当前材料缺少可直接分析的正文。",
        final_reason="系统检测到本次提交主要为附件材料，缺少可直接进入文本 RAG 的正文内容，因此暂不输出明确诈骗类型结论，建议先补充文本摘要、OCR 结果或转人工复核。",
        need_manual_review=True,
        stage_tags=[],
        hit_rules=[],
        rule_hits=[],
        extracted_entities={},
        input_highlights=[],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=["补充文字说明、OCR 提取文本或摘要后再发起检测。"],
        llm_model=None,
        result_detail=detail,
    )


@traceable(name="detection.process_job", run_type="chain")
def process_job(db: Session, job_id: uuid.UUID) -> DetectionJob:
    configure_langsmith_environment()
    job = detection_repository.get_job(db, job_id)
    if job is None:
        raise RuntimeError(f"Detection job not found: {job_id}")
    if job.status == "running":
        return job

    submission = detection_repository.get_submission(db, job.submission_id)
    if submission is None:
        raise RuntimeError(f"Detection submission not found for job: {job_id}")

    deep_reasoning = _job_uses_deep_reasoning(job)
    job.error_message = None
    job.started_at = _utcnow()
    job.finished_at = None
    job = _set_job_progress(
        db,
        job,
        status="running",
        step="preprocess",
        percent=8,
        extra={
            "submission_id": str(submission.id),
            "input_modality": job.input_modality,
            "analysis_mode": _analysis_mode_value(deep_reasoning=deep_reasoning),
            "deep_reasoning": deep_reasoning,
        },
    )

    try:
        if job.job_type == "agent_multimodal" and _should_use_agent_pipeline(submission):
            job = _set_job_progress(
                db,
                job,
                status="running",
                step="graph_reasoning",
                percent=58,
                extra={
                    "submission_id": str(submission.id),
                    "input_modality": job.input_modality,
                    "used_modules": ["planner"],
                },
            )
            try:
                agent_service = _load_agent_service()

                def agent_progress_callback(progress_event: dict[str, Any]) -> None:
                    nonlocal job
                    if not isinstance(progress_event, dict):
                        return
                    job = _set_job_progress(
                        db,
                        job,
                        status="running",
                        step="graph_reasoning",
                        percent=_estimate_agent_progress_percent(progress_event),
                        extra=_build_agent_progress_extra(
                            submission=submission,
                            input_modality=job.input_modality,
                            progress_event=progress_event,
                        ),
                    )

                with tracing_session():
                    analysis = agent_service.analyze_submission_with_progress(
                        db=db,
                        submission=submission,
                        progress_callback=agent_progress_callback,
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Agent detection failed, fallback to legacy pipeline: submission=%s", submission.id)
            else:
                if not isinstance(analysis, dict):
                    raise RuntimeError("Agent detection did not return a structured payload")
                result_row = _build_agent_result_row(
                    submission=submission,
                    job=job,
                    analysis=analysis,
                )
                existing_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}
                if submission.video_paths and not (
                    isinstance(existing_detail.get("video_ai_summary"), dict)
                    or isinstance(existing_detail.get("video_deception_summary"), dict)
                ):
                    result_row = _augment_result_with_video_ai(
                        submission=submission,
                        result_row=result_row,
                    )
                _persist_result_side_effects(db, submission=submission, result_row=result_row)

                result_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}
                job.rule_score = _resolve_agent_rule_score(analysis, result_detail)
                job.retrieval_query = _strip(str(analysis.get("retrieval_query") or "")) or None
                job.llm_model = result_row.llm_model or settings.agent_model or settings.detection_llm_model
                job.finished_at = _utcnow()
                job = _set_job_progress(
                    db,
                    job,
                    status="completed",
                    step="finalize",
                    percent=100,
                    extra={
                        "used_modules": result_detail.get("used_modules", []),
                        "reasoning_path": result_detail.get("reasoning_path", []),
                        "execution_trace": result_detail.get("execution_trace", []),
                        "module_trace": result_detail.get("module_trace", []),
                        "final_score": result_detail.get("final_score"),
                        "reasoning_graph": result_detail.get("reasoning_graph"),
                    },
                )
                return job

        if job.job_type == "video_ai":
            video_analysis_target = _job_video_analysis_target(job)
            used_modules = (
                ["video_ai_detection", "final_judge"]
                if video_analysis_target == "ai"
                else ["video_physiology_judgement", "final_judge"]
                if video_analysis_target == "physiology"
                else ["video_ai_detection", "video_physiology_judgement", "final_judge"]
            )
            job = _set_job_progress(
                db,
                job,
                status="running",
                step="embedding",
                percent=36,
                extra={
                    "input_modality": "video",
                    "video_count": len(submission.video_paths or []),
                    "used_modules": used_modules,
                    "module_trace": _build_video_execution_trace(
                        ai_detection_status="running",
                        physiology_status="pending",
                        final_status="pending",
                        video_analysis_target=video_analysis_target,
                        video_count=len(submission.video_paths or []),
                    ),
                },
            )
            if video_analysis_target == "ai":
                video_pairs, batch_result = _analyze_video_ai_submission(submission)
                batch_summary = dict(batch_result.get("summary") or {})
                job = _set_job_progress(
                    db,
                    job,
                    status="running",
                    step="graph_reasoning",
                    percent=72,
                    extra={
                        "input_modality": "video",
                        "video_count": len(video_pairs),
                        "used_modules": used_modules,
                        "module_trace": _build_video_execution_trace(
                            ai_detection_status="completed",
                            physiology_status="pending",
                            final_status="running",
                            video_analysis_target=video_analysis_target,
                            video_count=len(video_pairs),
                            d3_summary=batch_summary,
                        ),
                    },
                )
                result_row = _build_video_ai_only_result(
                    submission,
                    job,
                    video_pairs=video_pairs,
                    batch_result=batch_result,
                )
            elif video_analysis_target == "physiology":
                video_pairs, behavior_result = _analyze_video_physiology_submission(submission)
                behavior_summary = dict(behavior_result.get("summary") or {})
                job = _set_job_progress(
                    db,
                    job,
                    status="running",
                    step="graph_reasoning",
                    percent=72,
                    extra={
                        "input_modality": "video",
                        "video_count": len(video_pairs),
                        "used_modules": used_modules,
                        "module_trace": _build_video_execution_trace(
                            ai_detection_status="pending",
                            physiology_status="completed",
                            final_status="running",
                            video_analysis_target=video_analysis_target,
                            video_count=len(video_pairs),
                            behavior_summary=behavior_summary,
                        ),
                    },
                )
                result_row = _build_video_physiology_only_result(
                    submission,
                    job,
                    video_pairs=video_pairs,
                    behavior_result=behavior_result,
                )
            else:
                video_pairs, batch_result, behavior_result = _analyze_video_submission(submission)
                batch_summary = dict(batch_result.get("summary") or {})
                behavior_summary = dict(behavior_result.get("summary") or {})
                job = _set_job_progress(
                    db,
                    job,
                    status="running",
                    step="graph_reasoning",
                    percent=72,
                    extra={
                        "input_modality": "video",
                        "video_count": len(video_pairs),
                        "used_modules": used_modules,
                        "module_trace": _build_video_execution_trace(
                            ai_detection_status="completed",
                            physiology_status="running",
                            final_status="pending",
                            video_analysis_target=video_analysis_target,
                            video_count=len(video_pairs),
                            d3_summary=batch_summary,
                            behavior_summary=behavior_summary,
                        ),
                    },
                )
                result_row = _build_video_only_result_from_analysis(
                    submission,
                    job,
                    video_pairs=video_pairs,
                    batch_result=batch_result,
                    behavior_result=behavior_result,
                )
            _persist_result_side_effects(db, submission=submission, result_row=result_row)
            result_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}
            summary_key = "video_deception_summary" if video_analysis_target == "physiology" else "video_ai_summary"
            item_key = "video_deception_items" if video_analysis_target == "physiology" else "video_ai_items"
            video_summary = result_detail.get(summary_key) if isinstance(result_detail, dict) else {}
            lead_item = None
            if isinstance(video_summary, dict):
                candidate = video_summary.get("lead_item")
                if isinstance(candidate, dict):
                    lead_item = candidate
            if lead_item is None and isinstance(result_detail.get(item_key), list):
                for candidate in list(result_detail.get(item_key) or []):
                    if isinstance(candidate, dict):
                        lead_item = candidate
                        break

            job.rule_score = int(round(float(result_detail.get("final_score") or 0)))
            job.retrieval_query = _strip(str((lead_item or {}).get("file_name") or "")) or None
            if not job.retrieval_query and submission.video_paths:
                job.retrieval_query = Path(str(submission.video_paths[0])).name
            job.llm_model = result_row.llm_model or (
                _VIDEO_PHYSIOLOGY_MODEL_LABEL if video_analysis_target == "physiology" else _VIDEO_AI_MODEL_LABEL
            )
            job.finished_at = _utcnow()
            job = _set_job_progress(
                db,
                job,
                status="completed",
                step="finalize",
                percent=100,
                extra={
                    "used_modules": result_detail.get("used_modules", []),
                    "reasoning_path": result_detail.get("reasoning_path", []),
                    "module_trace": result_detail.get("module_trace", []),
                    "final_score": result_detail.get("final_score"),
                    "reasoning_graph": result_detail.get("reasoning_graph"),
                    "video_analysis_target": video_analysis_target,
                },
            )
            return job

        if job.job_type == "audio_verify":
            job = _set_job_progress(
                db,
                job,
                status="running",
                step="embedding",
                percent=36,
                extra={
                    "input_modality": "audio",
                    "audio_count": len(submission.audio_paths or []),
                },
            )
            result_row = _build_audio_only_result(submission, job)
            _persist_result_side_effects(db, submission=submission, result_row=result_row)
            result_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}
            audio_items = result_detail.get("audio_verify_items") if isinstance(result_detail, dict) else []
            top_audio_name = None
            if isinstance(audio_items, list) and audio_items:
                first_item = audio_items[0]
                if isinstance(first_item, dict):
                    top_audio_name = _strip(str(first_item.get("file_name") or ""))

            job.rule_score = int(round(float(result_detail.get("final_score") or 0)))
            job.retrieval_query = top_audio_name or None
            job.llm_model = result_row.llm_model or _AUDIO_VERIFY_MODEL_LABEL
            job.finished_at = _utcnow()
            job = _set_job_progress(
                db,
                job,
                status="completed",
                step="finalize",
                percent=100,
                extra={
                    "used_modules": result_detail.get("used_modules", []),
                    "reasoning_path": result_detail.get("reasoning_path", []),
                    "module_trace": result_detail.get("module_trace", []),
                    "final_score": result_detail.get("final_score"),
                    "reasoning_graph": result_detail.get("reasoning_graph"),
                },
            )
            return job

        if not _strip(submission.text_content):
            if submission.image_paths:
                job = _set_job_progress(
                    db,
                    job,
                    status="running",
                    step="embedding",
                    percent=32,
                    extra={
                        "input_modality": "image",
                        "image_count": len(submission.image_paths or []),
                    },
                )
                result_row = _build_image_only_result(submission, job)
                _persist_result_side_effects(db, submission=submission, result_row=result_row)
                result_detail = result_row.result_detail if isinstance(result_row.result_detail, dict) else {}

                top_match = None
                matches = result_detail.get("image_results") if isinstance(result_detail, dict) else []
                if isinstance(matches, list) and matches:
                    first = matches[0]
                    if isinstance(first, dict):
                        top_match = first.get("matches")

                job.rule_score = int(round(float(result_detail.get("final_score") or 0)))
                if isinstance(top_match, list):
                    labels = [
                        str(item.get("label"))
                        for item in top_match[:2]
                        if isinstance(item, dict) and str(item.get("label") or "").strip()
                    ]
                    job.retrieval_query = " / ".join(labels) if labels else None
                else:
                    job.retrieval_query = None
                job.llm_model = result_row.llm_model or "resnet18-imagebank"
                job.finished_at = _utcnow()
                job = _set_job_progress(
                    db,
                    job,
                    status="completed",
                    step="finalize",
                    percent=100,
                    extra={
                        "used_modules": result_detail.get("used_modules", []),
                        "reasoning_path": result_detail.get("reasoning_path", []),
                        "module_trace": result_detail.get("module_trace", []),
                        "final_score": result_detail.get("final_score"),
                        "reasoning_graph": result_detail.get("reasoning_graph"),
                    },
                )
                return job

            result_row = _build_attachment_only_result(submission, job)
            _persist_result_side_effects(db, submission=submission, result_row=result_row)
            job.rule_score = 0
            job.retrieval_query = None
            job.llm_model = None
            job.finished_at = _utcnow()
            job = _set_job_progress(
                db,
                job,
                status="completed",
                step="finalize",
                percent=100,
                extra={
                    "used_modules": ["preprocess", "finalize"],
                    "reasoning_path": ["附件", "缺少文本", "人工复核"],
                    "module_trace": result_row.result_detail.get("module_trace", []),
                },
            )
            return job

        def progress_callback(step: str, percent: int, detail: dict[str, Any] | None = None) -> None:
            _set_job_progress(db, job, status="running", step=step, percent=percent, extra=detail)

        analysis = analyzer.analyze_text_submission(
            db,
            text=submission.text_content or "",
            deep_reasoning=deep_reasoning,
            progress_callback=progress_callback,
        )
        result_payload = analysis.result_payload
        result_row = DetectionResult(
            submission_id=submission.id,
            job_id=job.id,
            risk_level=result_payload["risk_level"],
            fraud_type=result_payload["fraud_type"],
            confidence=result_payload["confidence"],
            is_fraud=result_payload["is_fraud"],
            summary=result_payload["summary"],
            final_reason=result_payload["final_reason"],
            need_manual_review=result_payload["need_manual_review"],
            stage_tags=result_payload["stage_tags"],
            hit_rules=result_payload["hit_rules"],
            rule_hits=result_payload["rule_hits"],
            extracted_entities=result_payload["extracted_entities"],
            input_highlights=result_payload["input_highlights"],
            retrieved_evidence=result_payload["retrieved_evidence"],
            counter_evidence=result_payload["counter_evidence"],
            advice=result_payload["advice"],
            llm_model=analysis.llm_model,
            result_detail=result_payload["result_detail"],
        )
        _persist_result_side_effects(db, submission=submission, result_row=result_row)

        result_detail = result_payload.get("result_detail") if isinstance(result_payload, dict) else {}
        if not isinstance(result_detail, dict):
            result_detail = {}

        job.rule_score = analysis.rule_score
        job.retrieval_query = analysis.retrieval_query
        job.llm_model = analysis.llm_model or settings.detection_llm_model
        job.finished_at = _utcnow()
        job = _set_job_progress(
            db,
            job,
            status="completed",
            step="finalize",
            percent=100,
            extra={
                "used_modules": result_detail.get("used_modules", []),
                "reasoning_path": result_detail.get("reasoning_path", []),
                "module_trace": result_detail.get("module_trace", []),
                "final_score": result_detail.get("final_score"),
                "reasoning_graph": result_detail.get("reasoning_graph"),
                "analysis_mode": result_detail.get("analysis_mode"),
            },
        )
        return job
    except Exception as exc:  # noqa: BLE001
        logger.exception("Detection job failed: %s", job.id)
        db.rollback()
        job.error_message = str(exc)[:4000]
        job.finished_at = _utcnow()
        job = _set_job_progress(
            db,
            job,
            status="failed",
            step=job.current_step or "finalize",
            percent=job.progress_percent or 0,
            extra={"error": job.error_message},
        )
        raise


def process_job_in_new_session(job_id: uuid.UUID) -> None:
    db = SessionLocal()
    try:
        process_job(db, job_id)
    finally:
        db.close()


def process_next_pending_job() -> DetectionJob | None:
    db = SessionLocal()
    try:
        job = detection_repository.get_next_pending_job(db)
        if job is None:
            return None
        return process_job(db, job.id)
    finally:
        db.close()


def detect_web_phishing(*, url: str, html: str | None = None, return_features: bool = False) -> dict[str, Any]:
    normalized_url = _strip(url)
    if not normalized_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="url 不能为空")
    try:
        from app.domain.detection.web_phishing_predictor import predict_web_phishing as _predict_web_phishing

        return _predict_web_phishing(normalized_url, html, return_features=return_features)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"网站钓鱼检测模型文件缺失：{exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"网站钓鱼检测输入无效：{exc}",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Web phishing detection failed")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"网站钓鱼检测失败：{exc}",
        ) from exc


_DIRECT_DETECTION_STAGE_TAG = "direct_detection"

_DIRECT_IMAGE_KIND_LABELS = {
    "ocr": "OCR话术识别",
    "official-document": "公章仿造检测",
    "pii": "敏感信息检测",
    "qr": "二维码URL检测",
    "impersonation": "网图识别",
}

_DIRECT_IMAGE_KIND_FRAUD_TYPES = {
    "ocr": FRAUD_TYPE_PHISHING_IMAGE,
    "official-document": FRAUD_TYPE_FORGED_DOC,
    "pii": FRAUD_TYPE_PII,
    "qr": FRAUD_TYPE_SUSPICIOUS_QR,
    "impersonation": FRAUD_TYPE_IMPERSONATION,
}


def _score_ratio(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if numeric > 1:
        numeric /= 100.0
    return max(0.0, min(1.0, numeric))



def _normalize_direct_risk_level(score: float, triggered: bool) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.45 or triggered:
        return "medium"
    return "low"



def _build_direct_module_trace(*, with_ocr: bool = False) -> list[dict[str, Any]]:
    trace = [{"key": "preprocess", "label": "预处理", "status": "completed"}]
    if with_ocr:
        trace.append({"key": "embedding", "label": "OCR解析", "status": "completed"})
    trace.extend(
        [
            {"key": "graph_reasoning", "label": "风险判定", "status": "completed"},
            {"key": "finalize", "label": "结果生成", "status": "completed"},
        ]
    )
    return trace



def _normalize_direct_similar_image_item(
    item: dict[str, Any],
    *,
    index: int,
    validated: bool = False,
) -> dict[str, Any] | None:
    title = _strip(str(item.get("title") or ""))
    source_url = _strip(str(item.get("source_url") or ""))
    image_url = _strip(str(item.get("image_url") or ""))
    thumbnail_url = _strip(str(item.get("thumbnail_url") or "")) or image_url
    domain = _strip(str(item.get("domain") or ""))
    provider = _strip(str(item.get("provider") or ""))
    match_type = _strip(str(item.get("match_type") or ""))

    if not any([title, source_url, image_url, thumbnail_url, domain]):
        return None

    raw_id = _strip(str(item.get("id") or ""))
    fallback = source_url or image_url or thumbnail_url or domain or f"similar-image-{index + 1}"
    normalized: dict[str, Any] = {
        "id": raw_id or f"{fallback}-{index + 1}",
        "title": title or None,
        "source_url": source_url or None,
        "image_url": image_url or None,
        "thumbnail_url": thumbnail_url or None,
        "domain": domain or None,
        "provider": provider or None,
        "match_type": match_type or None,
        "is_validated": bool(item.get("is_validated")) or validated,
        "clip_similarity": item.get("clip_similarity"),
        "hash_similarity": item.get("hash_similarity"),
        "phash_distance": item.get("phash_distance"),
        "dhash_distance": item.get("dhash_distance"),
        "hash_near_duplicate": bool(item.get("hash_near_duplicate")) if item.get("hash_near_duplicate") is not None else None,
        "clip_high_similarity": bool(item.get("clip_high_similarity")) if item.get("clip_high_similarity") is not None else None,
    }
    return normalized



def _collect_direct_similar_images(result: dict[str, Any]) -> list[dict[str, Any]]:
    raw = result.get("raw") if isinstance(result.get("raw"), dict) else {}
    validation = raw.get("similarity_validation") if isinstance(raw.get("similarity_validation"), dict) else {}
    validated_matches = validation.get("validated_matches") if isinstance(validation.get("validated_matches"), list) else []
    raw_matches = raw.get("matches") if isinstance(raw.get("matches"), list) else []
    evidence_items = result.get("evidence") if isinstance(result.get("evidence"), list) else []

    merged: list[tuple[dict[str, Any], bool]] = []
    merged.extend((item, True) for item in validated_matches if isinstance(item, dict))
    merged.extend((item, False) for item in raw_matches if isinstance(item, dict))

    for evidence in evidence_items:
        if not isinstance(evidence, dict):
            continue
        extra = evidence.get("extra") if isinstance(evidence.get("extra"), dict) else None
        if not extra:
            continue
        candidate = dict(extra)
        if not candidate.get("title") and evidence.get("title"):
            candidate["title"] = evidence.get("title")
        merged.append((candidate, str(evidence.get("severity") or "").strip().lower() == "warning"))

    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for index, (item, validated) in enumerate(merged):
        normalized = _normalize_direct_similar_image_item(item, index=index, validated=validated)
        if normalized is None:
            continue
        dedupe_key = "|".join(
            [
                _strip(str(normalized.get("source_url") or "")),
                _strip(str(normalized.get("image_url") or "")),
                _strip(str(normalized.get("thumbnail_url") or "")),
                _strip(str(normalized.get("domain") or "")),
            ]
        )
        dedupe_key = dedupe_key or str(normalized.get("id"))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        items.append(normalized)

    items.sort(
        key=lambda item: (
            0 if (item.get("is_validated") or item.get("hash_near_duplicate") or item.get("clip_high_similarity")) else 1,
            -(float(item.get("clip_similarity") or -1)),
            -(float(item.get("hash_similarity") or -1)),
        )
    )
    return items



def _build_direct_image_skill_result_row(
    *,
    submission: DetectionSubmission,
    job_id: uuid.UUID,
    kind: str,
    result_key: str,
    result: dict[str, Any],
    with_ocr: bool,
) -> DetectionResult:
    kind_label = _DIRECT_IMAGE_KIND_LABELS.get(kind, "专项检测")
    risk_score = _score_ratio(result.get("risk_score"))
    triggered = bool(result.get("triggered"))
    risk_level = _normalize_direct_risk_level(risk_score, triggered)
    score_percent = _score_to_percent(risk_score)
    labels = [str(item).strip() for item in list(result.get("labels") or []) if str(item).strip()]
    evidence_items = [item for item in list(result.get("evidence") or []) if isinstance(item, dict)]
    recommendations = [str(item).strip() for item in list(result.get("recommendations") or []) if str(item).strip()]
    similar_images = _collect_direct_similar_images(result) if kind == "impersonation" else []
    summary = _strip(str(result.get("summary") or "")) or f"{kind_label}已完成"
    first_reason = next(
        (
            _strip(str(item.get("detail") or ""))
            for item in evidence_items
            if _strip(str(item.get("detail") or ""))
        ),
        "",
    )
    final_reason = first_reason or summary
    matched_texts = [
        _strip(str(item.get("title") or ""))
        for item in evidence_items
        if _strip(str(item.get("title") or ""))
    ][:3]
    input_highlights = [
        {
            "text": _strip(str(item.get("title") or "")) or kind_label,
            "reason": _strip(str(item.get("detail") or "")) or summary,
        }
        for item in evidence_items[:3]
    ]
    module_trace = _build_direct_module_trace(with_ocr=with_ocr)
    used_modules = [str(item.get("key")) for item in module_trace if item.get("key")]
    reasoning_path = [kind_label, "风险判定", "结果生成"]
    llm_model = _strip(str((result.get("raw") or {}).get("provider") or "")) or None if isinstance(result.get("raw"), dict) else None

    result_detail: dict[str, Any] = {
        "kind": kind,
        "message": f"已完成{kind_label}",
        "final_score": score_percent,
        "used_modules": used_modules,
        "module_trace": module_trace,
        "reasoning_path": reasoning_path,
        "branches": {result_key: result},
        result_key: result,
        "direct_skill_result": result,
        "risk_evidence": [
            _strip(str(item.get("detail") or ""))
            for item in evidence_items[:5]
            if _strip(str(item.get("detail") or ""))
        ],
        "counter_evidence": [] if risk_level != "low" else [summary],
        "similar_images": similar_images,
        "similar_images_count": len(similar_images),
    }

    return DetectionResult(
        submission_id=submission.id,
        job_id=job_id,
        risk_level=risk_level,
        fraud_type=_DIRECT_IMAGE_KIND_FRAUD_TYPES.get(kind) if risk_level != "low" else None,
        confidence=risk_score,
        is_fraud=risk_level != "low",
        summary=summary,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=[kind_label, _DIRECT_DETECTION_STAGE_TAG],
        hit_rules=labels,
        rule_hits=[
            {
                "name": kind_label,
                "category": kind.replace("-", "_"),
                "risk_points": score_percent,
                "explanation": summary,
                "matched_texts": matched_texts,
                "stage_tag": kind_label,
                "fraud_type_hint": _DIRECT_IMAGE_KIND_FRAUD_TYPES.get(kind) if risk_level != "low" else None,
            }
        ],
        extracted_entities={
            "kind": kind,
            "risk_score": risk_score,
            "labels": labels,
            "evidence_count": len(evidence_items),
            "similar_images_count": len(similar_images),
        },
        input_highlights=input_highlights,
        retrieved_evidence=[],
        counter_evidence=[],
        advice=recommendations,
        llm_model=llm_model,
        result_detail=result_detail,
    )



def persist_direct_image_skill_result(
    db: Session,
    *,
    user_id: uuid.UUID,
    image_bytes: bytes,
    filename: str | None,
    kind: str,
    result_key: str,
    result: dict[str, Any],
    with_ocr: bool = False,
) -> dict[str, uuid.UUID]:
    safe_name = _strip(filename) or f"{kind}.jpg"
    bundles: dict[UploadKind, list[tuple[bytes, str]]] = {
        "text": [],
        "audio": [],
        "image": [(image_bytes, safe_name)],
        "video": [],
    }
    submission = create_submission(
        db,
        user_id=user_id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=settings.max_upload_bytes,
        text_content=None,
        relation_profile_id=None,
        file_bundles=bundles,
    )
    upload_rows = upload_service.sync_submission_uploads(
        db,
        submission_id=submission.id,
        user_id=submission.user_id,
        storage_batch_id=submission.storage_batch_id,
        text_paths=list(submission.text_paths or []),
        audio_paths=list(submission.audio_paths or []),
        image_paths=list(submission.image_paths or []),
        video_paths=list(submission.video_paths or []),
    )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=None,
        submission_id=submission.id,
        text_content=None,
        upload_rows=upload_rows,
    )

    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type=f"direct_{kind.replace('-', '_')}",
        input_modality="image",
        llm_model=None,
    )
    score_percent = _score_to_percent(_score_ratio(result.get("risk_score")))
    now = _utcnow()
    job.status = "completed"
    job.current_step = "finalize"
    job.progress_percent = 100
    job.started_at = now
    job.finished_at = now
    job.progress_detail = {
        "status": "completed",
        "current_step": "finalize",
        "progress_percent": 100,
        "module_trace": _build_direct_module_trace(with_ocr=with_ocr),
        "used_modules": [item["key"] for item in _build_direct_module_trace(with_ocr=with_ocr)],
        "final_score": score_percent,
    }
    job.rule_score = score_percent
    job.retrieval_query = safe_name
    detection_repository.save_job(db, job)

    result_row = _build_direct_image_skill_result_row(
        submission=submission,
        job_id=job.id,
        kind=kind,
        result_key=result_key,
        result=result,
        with_ocr=with_ocr,
    )
    persist_result_with_side_effects(
        db,
        submission=submission,
        result_row=result_row,
    )
    return {
        "submission_id": submission.id,
        "job_id": job.id,
        "result_id": result_row.id,
    }



def _normalize_web_risk_level(payload: dict[str, Any]) -> str:
    normalized = _strip(str(payload.get("risk_level") or "")).lower()
    if normalized == "high":
        return "high"
    if normalized in {"medium", "suspicious"}:
        return "medium"
    if normalized in {"safe", "low", "benign"}:
        return "low"
    return _normalize_direct_risk_level(_score_ratio(payload.get("phish_prob")), bool(payload.get("is_phishing")))



def _build_web_phishing_result_row(
    *,
    submission: DetectionSubmission,
    job_id: uuid.UUID,
    payload: dict[str, Any],
) -> DetectionResult:
    normalized_url = _strip(str(payload.get("url") or submission.text_content or ""))
    phish_prob = _score_ratio(payload.get("phish_prob"))
    confidence = _score_ratio(payload.get("confidence"))
    risk_level = _normalize_web_risk_level(payload)
    score_percent = _score_to_percent(phish_prob)
    summary = (
        "网址存在高风险钓鱼特征"
        if risk_level == "high"
        else "网址存在可疑钓鱼特征"
        if risk_level == "medium"
        else "网址未发现明显钓鱼特征"
    )
    final_reason = f"钓鱼概率 {score_percent}% · 可信度 {_score_to_percent(confidence)}%"
    advice = (
        ["勿输入账号密码", "先核验域名来源", "建议人工复核"]
        if risk_level != "low"
        else ["可继续核验页面", "建议保留检测记录"]
    )
    module_trace = [
        {"key": "preprocess", "label": "预处理", "status": "completed"},
        {"key": "graph_reasoning", "label": "风险判定", "status": "completed"},
        {"key": "finalize", "label": "结果生成", "status": "completed"},
    ]
    result_detail = {
        "message": "已完成网址钓鱼检测",
        "kind": "web_phishing",
        "final_score": score_percent,
        "used_modules": ["preprocess", "graph_reasoning", "finalize"],
        "module_trace": module_trace,
        "reasoning_path": ["网址钓鱼检测", "风险判定", "结果生成"],
        "web_phishing": payload,
        "phish_prob": phish_prob,
        "confidence": confidence,
        "url": normalized_url,
        "features": payload.get("features"),
    }
    return DetectionResult(
        submission_id=submission.id,
        job_id=job_id,
        risk_level=risk_level,
        fraud_type=FRAUD_TYPE_PHISHING_SITE if risk_level != "low" else None,
        confidence=confidence,
        is_fraud=bool(payload.get("is_phishing")) or risk_level != "low",
        summary=summary,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=["网址钓鱼检测", _DIRECT_DETECTION_STAGE_TAG],
        hit_rules=["web_phishing_detected"] if risk_level != "low" else [],
        rule_hits=[
            {
                "name": "网址钓鱼检测",
                "category": "web_phishing",
                "risk_points": score_percent,
                "explanation": final_reason,
                "matched_texts": [normalized_url] if normalized_url else [],
                "stage_tag": "网址钓鱼检测",
                "fraud_type_hint": FRAUD_TYPE_PHISHING_SITE if risk_level != "low" else None,
            }
        ],
        extracted_entities={
            "url": normalized_url,
            "phish_prob": phish_prob,
            "model_name": payload.get("model_name"),
        },
        input_highlights=[
            {
                "text": normalized_url or "网址",
                "reason": final_reason,
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=_strip(str(payload.get("model_name") or "")) or None,
        result_detail=result_detail,
    )



def persist_web_phishing_result(
    db: Session,
    *,
    user_id: uuid.UUID,
    url: str,
    payload: dict[str, Any],
) -> dict[str, uuid.UUID]:
    submission = create_submission(
        db,
        user_id=user_id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=settings.max_upload_bytes,
        text_content=url,
        relation_profile_id=None,
        file_bundles={"text": [], "audio": [], "image": [], "video": []},
    )
    upload_rows = upload_service.sync_submission_uploads(
        db,
        submission_id=submission.id,
        user_id=submission.user_id,
        storage_batch_id=submission.storage_batch_id,
        text_paths=list(submission.text_paths or []),
        audio_paths=list(submission.audio_paths or []),
        image_paths=list(submission.image_paths or []),
        video_paths=list(submission.video_paths or []),
    )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=None,
        submission_id=submission.id,
        text_content=submission.text_content,
        upload_rows=upload_rows,
    )

    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="web_phishing",
        input_modality="text",
        llm_model=_strip(str(payload.get("model_name") or "")) or None,
    )
    now = _utcnow()
    score_percent = _score_to_percent(_score_ratio(payload.get("phish_prob")))
    job.status = "completed"
    job.current_step = "finalize"
    job.progress_percent = 100
    job.started_at = now
    job.finished_at = now
    job.progress_detail = {
        "status": "completed",
        "current_step": "finalize",
        "progress_percent": 100,
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判定", "status": "completed"},
            {"key": "finalize", "label": "结果生成", "status": "completed"},
        ],
        "used_modules": ["preprocess", "graph_reasoning", "finalize"],
        "final_score": score_percent,
    }
    job.rule_score = score_percent
    job.retrieval_query = _strip(url) or None
    detection_repository.save_job(db, job)

    result_row = _build_web_phishing_result_row(
        submission=submission,
        job_id=job.id,
        payload=payload,
    )
    persist_result_with_side_effects(
        db,
        submission=submission,
        result_row=result_row,
    )
    return {
        "submission_id": submission.id,
        "job_id": job.id,
        "result_id": result_row.id,
    }


def _normalize_audio_scam_insight_risk_level(*, level: Any, score: float) -> str:
    normalized = _strip(str(level or "")).lower()
    if normalized in {"critical", "high"}:
        return "high"
    if normalized in {"medium", "suspicious"}:
        return "medium"
    if normalized in {"low", "safe", "benign"}:
        return "low"
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _build_audio_scam_insight_module_trace() -> list[dict[str, Any]]:
    return [
        {"key": "preprocess", "label": "预处理", "status": "completed"},
        {"key": "embedding", "label": "音频行为编码", "status": "completed"},
        {"key": "graph_reasoning", "label": "过程演化推理", "status": "completed"},
        {"key": "llm_reasoning", "label": "风险判定", "status": "completed"},
        {"key": "finalize", "label": "结果生成", "status": "completed"},
    ]


def _build_audio_scam_insight_result_row(
    *,
    submission: DetectionSubmission,
    job_id: uuid.UUID,
    payload: dict[str, Any],
    source_label: str | None,
) -> DetectionResult:
    decision = payload.get("decision") if isinstance(payload.get("decision"), dict) else {}
    dynamics = payload.get("dynamics") if isinstance(payload.get("dynamics"), dict) else {}
    behavior_profile = payload.get("behavior_profile") if isinstance(payload.get("behavior_profile"), dict) else {}
    modality_contrib = payload.get("modality_contrib") if isinstance(payload.get("modality_contrib"), dict) else {}
    evidence_segments = [item for item in list(payload.get("evidence_segments") or []) if isinstance(item, dict)]
    stage_sequence = [item for item in list(dynamics.get("stage_sequence") or []) if isinstance(item, dict)]
    key_moments = [item for item in list(dynamics.get("key_moments") or []) if isinstance(item, dict)]
    risk_curve = [item for item in list(dynamics.get("risk_curve") or []) if isinstance(item, dict)]

    call_risk_score = _score_ratio(decision.get("call_risk_score"))
    confidence = _score_ratio(decision.get("confidence"))
    if confidence <= 0:
        confidence = call_risk_score
    risk_level = _normalize_audio_scam_insight_risk_level(level=decision.get("risk_level"), score=call_risk_score)
    summary = _strip(str(decision.get("summary") or "")) or "语音深度分析已完成"
    final_reason = _strip(str(decision.get("explanation") or "")) or summary
    suggested_actions = [str(item).strip() for item in list(decision.get("suggested_actions") or []) if str(item).strip()]

    risk_evidence = [
        _strip(str(item.get("explanation") or ""))
        for item in evidence_segments[:5]
        if _strip(str(item.get("explanation") or ""))
    ]
    matched_texts = [
        _strip(str(item.get("stage_label") or ""))
        for item in evidence_segments[:3]
        if _strip(str(item.get("stage_label") or ""))
    ]
    input_highlights = [
        {
            "text": _strip(str(item.get("stage_label") or "")) or (_strip(source_label) or "语音片段"),
            "reason": _strip(str(item.get("explanation") or "")) or summary,
        }
        for item in evidence_segments[:3]
    ]
    if not input_highlights and _strip(source_label):
        input_highlights = [{"text": _strip(source_label), "reason": summary}]

    module_trace = _build_audio_scam_insight_module_trace()
    used_modules = [str(item.get("key")) for item in module_trace if item.get("key")]
    final_score = _score_to_percent(call_risk_score)
    is_fraud = risk_level != "low" or call_risk_score >= 0.5

    result_detail = {
        "kind": "audio_scam_insight",
        "message": "语音深度分析已完成",
        "final_score": final_score,
        "used_modules": used_modules,
        "module_trace": module_trace,
        "reasoning_path": ["音频行为分析", "过程演化分析", "风险判定", "结果生成"],
        "audio_scam_insight": payload,
        "behavior_profile": behavior_profile,
        "dynamics": dynamics,
        "evidence_segments": evidence_segments,
        "decision": decision,
        "modality_contrib": modality_contrib,
        "risk_evidence": risk_evidence,
        "counter_evidence": [] if is_fraud else [summary],
        "stage_count": len(stage_sequence),
        "key_moment_count": len(key_moments),
        "evidence_count": len(evidence_segments),
        "source_label": _strip(source_label) or None,
    }

    return DetectionResult(
        submission_id=submission.id,
        job_id=job_id,
        risk_level=risk_level,
        fraud_type=FRAUD_TYPE_VOICE_SCAM_CALL if is_fraud else None,
        confidence=confidence,
        is_fraud=is_fraud,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=risk_level == "medium",
        stage_tags=["audio_scam_insight", _DIRECT_DETECTION_STAGE_TAG],
        hit_rules=["audio_scam_insight_detected"] if is_fraud else [],
        rule_hits=[
            {
                "name": "audio_scam_insight",
                "category": "audio_scam_insight",
                "risk_points": final_score,
                "explanation": final_reason,
                "matched_texts": matched_texts,
                "stage_tag": "audio_scam_insight",
                "fraud_type_hint": FRAUD_TYPE_VOICE_SCAM_CALL if is_fraud else None,
            }
        ],
        extracted_entities={
            "call_risk_score": call_risk_score,
            "decision_confidence": confidence,
            "risk_level_raw": _strip(str(decision.get("risk_level") or "")) or None,
            "stage_count": len(stage_sequence),
            "key_moment_count": len(key_moments),
            "evidence_count": len(evidence_segments),
            "total_duration_sec": dynamics.get("total_duration_sec"),
            "peak_risk_sec": dynamics.get("peak_risk_sec"),
            "behavior_profile": behavior_profile,
            "modality_contrib": modality_contrib,
            "risk_curve_points": len(risk_curve),
        },
        input_highlights=input_highlights,
        retrieved_evidence=[],
        counter_evidence=[],
        advice=suggested_actions,
        llm_model=None,
        result_detail=result_detail,
    )


def _build_audio_scam_insight_completed_job(
    db: Session,
    *,
    submission: DetectionSubmission,
    llm_model: str | None,
    retrieval_query: str | None,
    score_ratio: float,
) -> DetectionJob:
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="audio_scam_insight",
        input_modality="audio",
        llm_model=_strip(llm_model) or None,
    )
    module_trace = _build_audio_scam_insight_module_trace()
    now = _utcnow()
    score_percent = _score_to_percent(score_ratio)
    job.status = "completed"
    job.current_step = "finalize"
    job.progress_percent = 100
    job.started_at = now
    job.finished_at = now
    job.progress_detail = {
        "status": "completed",
        "current_step": "finalize",
        "progress_percent": 100,
        "module_trace": module_trace,
        "used_modules": [item["key"] for item in module_trace],
        "final_score": score_percent,
    }
    job.rule_score = score_percent
    job.retrieval_query = _strip(retrieval_query) or None
    return detection_repository.save_job(db, job)


def persist_audio_scam_insight_from_bytes(
    db: Session,
    *,
    user_id: uuid.UUID,
    audio_bytes: bytes,
    filename: str | None,
    insight_payload: dict[str, Any],
) -> dict[str, uuid.UUID]:
    safe_name = _strip(filename) or "audio-scam-insight.wav"
    bundles: dict[UploadKind, list[tuple[bytes, str]]] = {
        "text": [],
        "audio": [(audio_bytes, safe_name)],
        "image": [],
        "video": [],
    }
    submission = create_submission(
        db,
        user_id=user_id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=settings.max_upload_bytes,
        text_content=None,
        relation_profile_id=None,
        file_bundles=bundles,
    )
    upload_rows = upload_service.sync_submission_uploads(
        db,
        submission_id=submission.id,
        user_id=submission.user_id,
        storage_batch_id=submission.storage_batch_id,
        text_paths=list(submission.text_paths or []),
        audio_paths=list(submission.audio_paths or []),
        image_paths=list(submission.image_paths or []),
        video_paths=list(submission.video_paths or []),
    )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=None,
        submission_id=submission.id,
        text_content=None,
        upload_rows=upload_rows,
    )

    decision = insight_payload.get("decision") if isinstance(insight_payload.get("decision"), dict) else {}
    call_risk_score = _score_ratio(decision.get("call_risk_score"))
    job = _build_audio_scam_insight_completed_job(
        db,
        submission=submission,
        llm_model=None,
        retrieval_query=safe_name,
        score_ratio=call_risk_score,
    )
    result_row = _build_audio_scam_insight_result_row(
        submission=submission,
        job_id=job.id,
        payload=insight_payload,
        source_label=safe_name,
    )
    persist_result_with_side_effects(
        db,
        submission=submission,
        result_row=result_row,
    )
    return {
        "submission_id": submission.id,
        "job_id": job.id,
        "result_id": result_row.id,
    }


def persist_audio_scam_insight_from_upload_path(
    db: Session,
    *,
    user_id: uuid.UUID,
    audio_path: str,
    filename: str | None,
    insight_payload: dict[str, Any],
) -> dict[str, uuid.UUID]:
    selected_path = _normalize_requested_paths([audio_path])[0]
    upload_rows = _resolve_audio_upload_rows_for_paths(
        db,
        user_id=user_id,
        audio_paths=[selected_path],
    )
    submission = detection_repository.save_submission(
        db,
        DetectionSubmission(
            user_id=user_id,
            relation_profile_id=None,
            storage_batch_id=_build_reused_storage_batch_id("audio-scam-insight"),
            has_text=False,
            has_audio=True,
            has_image=False,
            has_video=False,
            text_paths=[],
            audio_paths=[selected_path],
            image_paths=[],
            video_paths=[],
            text_content=None,
        ),
    )
    relation_service.attach_submission_context(
        db,
        user_id=submission.user_id,
        relation_id=None,
        submission_id=submission.id,
        text_content=None,
        upload_rows=_group_upload_rows_by_selected_paths(
            upload_rows=upload_rows,
            selected_paths=[selected_path],
            submission_id=submission.id,
        ),
    )

    decision = insight_payload.get("decision") if isinstance(insight_payload.get("decision"), dict) else {}
    call_risk_score = _score_ratio(decision.get("call_risk_score"))
    source_label = _strip(filename) or Path(selected_path).name or selected_path
    job = _build_audio_scam_insight_completed_job(
        db,
        submission=submission,
        llm_model=None,
        retrieval_query=source_label,
        score_ratio=call_risk_score,
    )
    result_row = _build_audio_scam_insight_result_row(
        submission=submission,
        job_id=job.id,
        payload=insight_payload,
        source_label=source_label,
    )
    persist_result_with_side_effects(
        db,
        submission=submission,
        result_row=result_row,
    )
    return {
        "submission_id": submission.id,
        "job_id": job.id,
        "result_id": result_row.id,
    }
