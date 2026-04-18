"""检测任务编排与执行服务。"""
from __future__ import annotations

from collections import defaultdict
import logging
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
from app.domain.agent.trace import action_label

logger = logging.getLogger(__name__)

_TEXT_DECODE_SUFFIXES = {".txt", ".md", ".json", ".csv", ".log", ".html", ".htm"}
_HISTORY_SCOPES = {"day", "month", "year"}
_LOCAL_TIMEZONE = ZoneInfo("Asia/Shanghai")
_AUDIO_VERIFY_MODEL_LABEL = "audio-verify-v1"
_PIPELINE_STEPS = [
    ("preprocess", "清洗"),
    ("embedding", "编码"),
    ("vector_retrieval", "召回"),
    ("graph_reasoning", "图谱"),
    ("llm_reasoning", "判别"),
    ("finalize", "完成"),
]

def _load_audio_detector_module():
    from app.domain.detection import audio_detector as audio_detector_module

    return audio_detector_module


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _local_now() -> datetime:
    return datetime.now(_LOCAL_TIMEZONE)


def _strip(s: str | None) -> str:
    return (s or "").strip()


def _analysis_mode_value(*, deep_reasoning: bool) -> str:
    return "deep" if deep_reasoning else "standard"


def _analysis_mode_source(*, requested: bool | None, resolved: bool) -> str:
    if isinstance(requested, bool):
        return "request"
    return "default_text_deep" if resolved else "default_standard"


def _job_uses_deep_reasoning(job: DetectionJob | None) -> bool:
    if job is None:
        return False
    progress_detail = dict(job.progress_detail or {})
    if progress_detail.get("deep_reasoning") is True:
        return True
    return str(progress_detail.get("analysis_mode") or "").strip().lower() == "deep"


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
    job.progress_detail = _build_progress_detail(
        current_step=current_step,
        status=job.status,
        percent=current_percent,
        extra=extra,
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


def _persist_result_side_effects(
    db: Session,
    *,
    submission: DetectionSubmission,
    result_row: DetectionResult,
) -> None:
    detection_repository.save_result(db, result_row)
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
    return _job_uses_deep_reasoning(latest_job)


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
            deep_reasoning=_job_uses_deep_reasoning(job),
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
    "ocr": "phishing_image",
    "official-document": "forged_official_document",
    "pii": "sensitive_information_exposure",
    "qr": "suspicious_qr",
    "impersonation": "impersonation_or_stolen_image",
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
        fraud_type="phishing_site" if risk_level != "low" else None,
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
                "fraud_type_hint": "phishing_site" if risk_level != "low" else None,
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
