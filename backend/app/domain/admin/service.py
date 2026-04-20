"""Admin analytics service."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status

from app.domain.admin import repository
from app.domain.detection import repository as detection_repository
from app.shared.core.config import settings

_MODALITY_LABELS = (
    ("text_count", "文本"),
    ("audio_count", "音频"),
    ("image_count", "图片"),
    ("video_count", "视频"),
)

_RISK_LABELS = (
    ("high", "高风险"),
    ("medium", "中风险"),
    ("low", "低风险"),
)

_CORRECTION_LABELS = ("误判", "漏判", "补充信息", "其他")


def get_analytics_overview(db) -> dict:
    modality_counts = repository.get_detection_modality_counts(db)
    detection_trend_rows = repository.get_detection_trend(db, days=7)
    risk_rows = repository.get_risk_level_counts(db)
    fraud_rows = repository.get_fraud_type_counts(db, limit=7)
    feedback_summary = repository.get_feedback_summary(db)
    feedback_trend_rows = repository.get_feedback_trend(db, days=7)
    correction_rows = repository.get_feedback_correction_counts(db)
    rag_overview_row = repository.get_rag_vector_overview(db, embedding_model=settings.rag_embedding_model)
    rag_trend_rows = repository.get_rag_sync_trend(db, embedding_model=settings.rag_embedding_model, days=7)

    risk_map = {str(item.get("risk_level") or "").strip().lower(): int(item.get("total") or 0) for item in risk_rows}
    correction_map = {str(item.get("correction_type") or ""): int(item.get("total") or 0) for item in correction_rows}

    detection_counts = [
        {"label": label, "value": int(modality_counts.get(key, 0))}
        for key, label in _MODALITY_LABELS
    ]

    detection_trend = [
        {
            "day": str(row.get("day_label") or ""),
            "文本": int(row.get("text_count") or 0),
            "音频": int(row.get("audio_count") or 0),
            "图片": int(row.get("image_count") or 0),
            "视频": int(row.get("video_count") or 0),
        }
        for row in detection_trend_rows
    ]

    risk_level_counts = [{"label": label, "value": int(risk_map.get(key, 0))} for key, label in _RISK_LABELS]

    fraud_type_counts = [
        {
            "label": str(item.get("fraud_type") or "未分类"),
            "value": int(item.get("total") or 0),
        }
        for item in fraud_rows
    ]

    feedback_trend = [
        {
            "day": str(row.get("day_label") or ""),
            "总数": int(row.get("total_count") or 0),
            "有效": int(row.get("helpful_count") or 0),
        }
        for row in feedback_trend_rows
    ]

    feedback_correction_counts = [
        {"label": label, "value": int(correction_map.get(label, 0))}
        for label in _CORRECTION_LABELS
    ]

    rag_overview = {
        "embedding_model": settings.rag_embedding_model,
        "source_total": int(rag_overview_row.get("source_total") or 0),
        "vectorized_source_total": int(rag_overview_row.get("vectorized_source_total") or 0),
        "chunk_total": int(rag_overview_row.get("chunk_total") or 0),
        "completed_total": int(rag_overview_row.get("completed_total") or 0),
        "empty_total": int(rag_overview_row.get("empty_total") or 0),
        "failed_total": int(rag_overview_row.get("failed_total") or 0),
        "pending_total": int(rag_overview_row.get("pending_total") or 0),
        "latest_synced_at": rag_overview_row.get("latest_synced_at"),
    }

    rag_status_counts = [
        {"label": "已向量化", "value": rag_overview["vectorized_source_total"]},
        {"label": "空结果", "value": rag_overview["empty_total"]},
        {"label": "失败", "value": rag_overview["failed_total"]},
        {"label": "待处理", "value": rag_overview["pending_total"]},
    ]

    rag_sync_trend = [
        {
            "day": str(row.get("day_label") or ""),
            "向量化源数": int(row.get("source_count") or 0),
            "向量块数": int(row.get("chunk_total") or 0),
        }
        for row in rag_trend_rows
    ]

    return {
        "summary": {
            "submission_total": int(modality_counts.get("submission_total", 0)),
            "high_risk_total": int(risk_map.get("high", 0)),
            "vectorized_source_total": rag_overview["vectorized_source_total"],
            "vector_chunk_total": rag_overview["chunk_total"],
        },
        "detection_counts": detection_counts,
        "detection_trend": detection_trend,
        "risk_level_counts": risk_level_counts,
        "fraud_type_counts": fraud_type_counts,
        "feedback_summary": feedback_summary,
        "feedback_trend": feedback_trend,
        "feedback_correction_counts": feedback_correction_counts,
        "rag_overview": rag_overview,
        "rag_status_counts": rag_status_counts,
        "rag_sync_trend": rag_sync_trend,
    }


def _mask_phone(phone: str | None) -> str | None:
    value = str(phone or "").strip()
    if not value:
        return None
    if len(value) == 11:
        return f"{value[:3]}****{value[-4:]}"
    return value


def _build_preview(text: str | None) -> str:
    content = str(text or "").strip()
    if not content:
        return ""
    return content[:120] + ("…" if len(content) > 120 else "")


def _resolve_correction_type(item: dict[str, Any]) -> str:
    user_label = str(item.get("user_label") or "").strip()
    stored_is_fraud = item.get("stored_is_fraud")
    reviewed_fraud_type = str(item.get("reviewed_fraud_type") or "").strip()
    note = str(item.get("note") or "").strip()

    if user_label == "safe" and stored_is_fraud is True:
        return "误判"
    if user_label == "fraud" and stored_is_fraud is False:
        return "漏判"
    if reviewed_fraud_type or note:
        return "补充信息"
    return "其他"


def _resolve_effective_status(helpful: Any) -> str:
    if helpful is True:
        return "有效"
    if helpful is False:
        return "无效"
    return "待定"


def list_feedback(db, *, limit: int) -> list[dict[str, Any]]:
    rows = repository.list_feedback(db, limit=limit)
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["user_phone_masked"] = _mask_phone(item.pop("user_phone", None))
        item["preview"] = _build_preview(item.pop("submission_text_content", None))
        item["effective_status"] = _resolve_effective_status(item.get("helpful"))
        item["correction_type"] = _resolve_correction_type(item)
        items.append(item)
    return items


def record_feedback(
    db,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    user_label: str,
    reviewed_fraud_type: str | None,
    helpful: bool | None,
    note: str | None,
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
    return repository.upsert_feedback(
        db,
        user_id=user_id,
        submission_id=submission.id,
        job_id=job.id,
        result_id=result.id if result else None,
        user_label=str(user_label or "unknown").strip() or "unknown",
        reviewed_fraud_type=str(reviewed_fraud_type or "").strip() or None,
        helpful=helpful,
        note=str(note or "").strip() or None,
    )
