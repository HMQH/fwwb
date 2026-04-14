"""检测提交流程与任务执行。"""
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
                    detail=f"文件过大，超过 {max_upload_bytes} 字节限制",
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
            detail="至少提供一种输入：文字内容或任意附件文件",
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
        if submission.image_paths:
            attachment_parts.append(f"图片 {len(submission.image_paths)}")
        if submission.audio_paths:
            attachment_parts.append(f"音频 {len(submission.audio_paths)}")
        if submission.video_paths:
            attachment_parts.append(f"视频 {len(submission.video_paths)}")
        preview = "、".join(attachment_parts) if attachment_parts else None

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="检测记录不存在")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="检测任务不存在")
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=job.submission_id,
        user_id=user_id,
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="检测任务不存在")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="检测记录不存在")
    return detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="text_rag",
        input_modality="text" if submission.text_content else "attachment_only",
        llm_model=settings.detection_llm_model,
    )


def _build_attachment_only_result(submission: DetectionSubmission, job: DetectionJob) -> DetectionResult:
    detail = {
        "message": "当前版本优先支持文本 RAG 检测；本次提交未提取到可分析文本。",
        "attachment_counts": {
            "text_files": len(submission.text_paths or []),
            "audio_files": len(submission.audio_paths or []),
            "image_files": len(submission.image_paths or []),
            "video_files": len(submission.video_paths or []),
        },
    }
    return DetectionResult(
        submission_id=submission.id,
        job_id=job.id,
        risk_level="low",
        fraud_type="待补充文本",
        confidence=0.12,
        is_fraud=False,
        summary="未提取到可分析文本，暂无法做文本 RAG 判断。",
        final_reason="当前任务没有可直接送入文本检索与分析链路的文字内容，因此仅保留附件记录。",
        need_manual_review=True,
        stage_tags=[],
        hit_rules=[],
        rule_hits=[],
        extracted_entities={},
        input_highlights=[],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=["请补充聊天文本、短信内容或可复制的文字后重新检测。"],
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

    job.status = "running"
    job.error_message = None
    job.started_at = _utcnow()
    job.finished_at = None
    detection_repository.save_job(db, job)

    try:
        if not _strip(submission.text_content):
            result_row = _build_attachment_only_result(submission, job)
            detection_repository.save_result(db, result_row)
            job.rule_score = 0
            job.retrieval_query = None
            job.llm_model = settings.detection_llm_model
            job.status = "completed"
            job.finished_at = _utcnow()
            detection_repository.save_job(db, job)
            return job

        analysis = analyzer.analyze_text_submission(db, text=submission.text_content or "")
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

        job.rule_score = analysis.rule_score
        job.retrieval_query = analysis.retrieval_query
        job.llm_model = analysis.llm_model or settings.detection_llm_model
        job.status = "completed"
        job.finished_at = _utcnow()
        detection_repository.save_job(db, job)
        return job
    except Exception as exc:  # noqa: BLE001
        logger.exception("Detection job failed: %s", job.id)
        db.rollback()
        job.status = "failed"
        job.error_message = str(exc)[:4000]
        job.finished_at = _utcnow()
        detection_repository.save_job(db, job)
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
