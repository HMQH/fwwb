"""检测任务编排与执行服务。"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection import analyzer, repository as detection_repository
from app.domain.detection.entity import DetectionJob, DetectionResult, DetectionSubmission
from app.domain.detection.kinds import UploadKind
from app.shared.core.config import settings
from app.shared.db.session import SessionLocal
from app.shared.storage.file_validation import validate_bundle_filenames
from app.shared.storage.upload_paths import (
    allocate_batch_folder_name,
    resolved_upload_root,
    safe_suffix,
    save_upload_bytes,
)

logger = logging.getLogger(__name__)

_TEXT_DECODE_SUFFIXES = {".txt", ".md", ".json", ".csv", ".log", ".html", ".htm"}
_PIPELINE_STEPS = [
    ("preprocess", "清洗"),
    ("embedding", "编码"),
    ("vector_retrieval", "召回"),
    ("graph_reasoning", "图谱"),
    ("llm_reasoning", "判别"),
    ("finalize", "完成"),
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _strip(s: str | None) -> str:
    return (s or "").strip()


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


def _initialize_job_progress(db: Session, job: DetectionJob) -> DetectionJob:
    return _set_job_progress(
        db,
        job,
        status=job.status,
        step=job.current_step or "queued",
        percent=0,
        extra={
            "input_modality": job.input_modality,
            "job_type": job.job_type,
        },
    )


def create_submission(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_root_cfg: str,
    max_upload_bytes: int,
    text_content: str | None,
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


def _build_submission_snapshot(
    submission: DetectionSubmission,
    *,
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

    return {
        "submission": {
            "id": submission.id,
            "user_id": submission.user_id,
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
        },
        "latest_job": _build_job_snapshot(latest_job, latest_result) if latest_job is not None else None,
        "latest_result": _build_result_snapshot(latest_result),
        "content_preview": preview,
    }


def submit_detection(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_root_cfg: str,
    max_upload_bytes: int,
    text_content: str | None,
    file_bundles: dict[UploadKind, list[tuple[bytes, str]]],
) -> tuple[DetectionSubmission, DetectionJob]:
    submission = create_submission(
        db,
        user_id=user_id,
        upload_root_cfg=upload_root_cfg,
        max_upload_bytes=max_upload_bytes,
        text_content=text_content,
        file_bundles=file_bundles,
    )
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="text_rag",
        input_modality="text" if submission.text_content else "attachment_only",
        llm_model=settings.detection_llm_model,
    )
    job = _initialize_job_progress(db, job)
    return submission, job


def list_history(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[dict[str, Any]]:
    submissions = detection_repository.list_submissions_for_user(db, user_id=user_id, limit=limit)
    items: list[dict[str, Any]] = []
    for submission in submissions:
        latest_job = detection_repository.get_latest_job_for_submission(db, submission_id=submission.id)
        latest_result = detection_repository.get_latest_result_for_submission(db, submission_id=submission.id)
        items.append(
            _build_submission_snapshot(
                submission,
                latest_job=latest_job,
                latest_result=latest_result,
            )
        )
    return items


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
        submission,
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
    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="text_rag",
        input_modality="text" if submission.text_content else "attachment_only",
        llm_model=settings.detection_llm_model,
    )
    return _initialize_job_progress(db, job)


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
    detail = {
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


def process_job(db: Session, job_id: uuid.UUID) -> DetectionJob:
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
        if not _strip(submission.text_content):
            result_row = _build_attachment_only_result(submission, job)
            detection_repository.save_result(db, result_row)
            job.rule_score = 0
            job.retrieval_query = None
            job.llm_model = settings.detection_llm_model
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
        detection_repository.save_result(db, result_row)

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
