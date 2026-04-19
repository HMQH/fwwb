"""检测任务持久化。"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.domain.detection.entity import (
    DetectionJob,
    DetectionReasoningEdge,
    DetectionReasoningNode,
    DetectionReasoningStage,
    DetectionResult,
    DetectionSubmission,
)


def _apply_submission_time_range(stmt, *, start_at=None, end_at=None):
    if start_at is not None:
        stmt = stmt.where(DetectionSubmission.created_at >= start_at)
    if end_at is not None:
        stmt = stmt.where(DetectionSubmission.created_at < end_at)
    return stmt


def save_submission(db: Session, row: DetectionSubmission) -> DetectionSubmission:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_submission(db: Session, submission_id: uuid.UUID) -> DetectionSubmission | None:
    return db.get(DetectionSubmission, submission_id)


def get_submission_for_user(
    db: Session,
    *,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
) -> DetectionSubmission | None:
    stmt = (
        select(DetectionSubmission)
        .where(DetectionSubmission.id == submission_id)
        .where(DetectionSubmission.user_id == user_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_submissions_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    offset: int = 0,
    start_at=None,
    end_at=None,
) -> list[DetectionSubmission]:
    stmt = _apply_submission_time_range(
        select(DetectionSubmission)
        .where(DetectionSubmission.user_id == user_id)
        .order_by(DetectionSubmission.created_at.desc())
        .offset(offset)
        .limit(limit),
        start_at=start_at,
        end_at=end_at,
    )
    return list(db.execute(stmt).scalars().all())


def count_submissions_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    start_at=None,
    end_at=None,
) -> int:
    stmt = _apply_submission_time_range(
        select(func.count(DetectionSubmission.id)).where(DetectionSubmission.user_id == user_id),
        start_at=start_at,
        end_at=end_at,
    )
    return int(db.execute(stmt).scalar() or 0)


def list_submission_risk_rows_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    start_at=None,
    end_at=None,
) -> list[tuple]:
    latest_result_sq = (
        select(
            DetectionResult.submission_id.label("submission_id"),
            func.max(DetectionResult.created_at).label("latest_created_at"),
        )
        .group_by(DetectionResult.submission_id)
        .subquery()
    )

    stmt = _apply_submission_time_range(
        select(DetectionSubmission.created_at, DetectionResult.risk_level)
        .select_from(DetectionSubmission)
        .outerjoin(
            latest_result_sq,
            latest_result_sq.c.submission_id == DetectionSubmission.id,
        )
        .outerjoin(
            DetectionResult,
            and_(
                DetectionResult.submission_id == DetectionSubmission.id,
                DetectionResult.created_at == latest_result_sq.c.latest_created_at,
            ),
        )
        .where(DetectionSubmission.user_id == user_id)
        .order_by(DetectionSubmission.created_at.asc()),
        start_at=start_at,
        end_at=end_at,
    )
    return list(db.execute(stmt).all())


def create_job(
    db: Session,
    *,
    submission_id: uuid.UUID,
    job_type: str,
    input_modality: str,
    llm_model: str | None,
) -> DetectionJob:
    job = DetectionJob(
        submission_id=submission_id,
        job_type=job_type,
        input_modality=input_modality,
        status="pending",
        llm_model=llm_model,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def save_job(db: Session, job: DetectionJob) -> DetectionJob:
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job(db: Session, job_id: uuid.UUID) -> DetectionJob | None:
    return db.get(DetectionJob, job_id)


def list_jobs_for_submission(
    db: Session,
    *,
    submission_id: uuid.UUID,
    limit: int = 10,
) -> list[DetectionJob]:
    stmt = (
        select(DetectionJob)
        .where(DetectionJob.submission_id == submission_id)
        .order_by(DetectionJob.created_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def get_latest_job_for_submission(
    db: Session,
    *,
    submission_id: uuid.UUID,
) -> DetectionJob | None:
    stmt = (
        select(DetectionJob)
        .where(DetectionJob.submission_id == submission_id)
        .order_by(DetectionJob.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def get_next_pending_job(db: Session) -> DetectionJob | None:
    stmt = (
        select(DetectionJob)
        .where(DetectionJob.status == "pending")
        .order_by(DetectionJob.created_at.asc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def save_result(db: Session, row: DetectionResult) -> DetectionResult:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_result(db: Session, result_id: uuid.UUID) -> DetectionResult | None:
    return db.get(DetectionResult, result_id)


def get_result_for_job(db: Session, *, job_id: uuid.UUID) -> DetectionResult | None:
    stmt = (
        select(DetectionResult)
        .where(DetectionResult.job_id == job_id)
        .order_by(DetectionResult.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def get_latest_result_for_submission(
    db: Session,
    *,
    submission_id: uuid.UUID,
) -> DetectionResult | None:
    stmt = (
        select(DetectionResult)
        .where(DetectionResult.submission_id == submission_id)
        .order_by(DetectionResult.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_recent_results_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[tuple[DetectionResult, DetectionSubmission]]:
    stmt = (
        select(DetectionResult, DetectionSubmission)
        .join(DetectionSubmission, DetectionSubmission.id == DetectionResult.submission_id)
        .where(DetectionSubmission.user_id == user_id)
        .order_by(DetectionResult.created_at.desc())
        .limit(limit)
    )
    return [(result, submission) for result, submission in db.execute(stmt).all()]


def replace_reasoning_snapshot(
    db: Session,
    *,
    submission_id: uuid.UUID,
    result_id: uuid.UUID,
    snapshot: dict,
) -> None:
    db.execute(delete(DetectionReasoningStage).where(DetectionReasoningStage.result_id == result_id))
    db.execute(delete(DetectionReasoningNode).where(DetectionReasoningNode.result_id == result_id))
    db.execute(delete(DetectionReasoningEdge).where(DetectionReasoningEdge.result_id == result_id))

    for item in list(snapshot.get("stages") or []):
        if not isinstance(item, dict):
            continue
        db.add(
            DetectionReasoningStage(
                submission_id=submission_id,
                result_id=result_id,
                stage_code=str(item.get("stage_code") or ""),
                stage_label=str(item.get("stage_label") or ""),
                stage_order=int(item.get("stage_order") or 0),
                score=float(item.get("score") or 0.0),
                support_score=float(item.get("support_score") or 0.0),
                is_active=bool(item.get("is_active")),
                tone=str(item.get("tone") or "") or None,
                detail=str(item.get("detail") or "") or None,
            )
        )

    for item in list(snapshot.get("nodes") or []):
        if not isinstance(item, dict):
            continue
        db.add(
            DetectionReasoningNode(
                submission_id=submission_id,
                result_id=result_id,
                node_key=str(item.get("node_key") or ""),
                node_label=str(item.get("node_label") or ""),
                node_type=str(item.get("node_type") or ""),
                tone=str(item.get("tone") or "") or None,
                lane=int(item.get("lane") or 0),
                sort_order=int(item.get("sort_order") or 0),
                weight=float(item.get("weight") or 0.0),
                stage_code=str(item.get("stage_code") or "") or None,
                detail=str(item.get("detail") or "") or None,
            )
        )

    for item in list(snapshot.get("edges") or []):
        if not isinstance(item, dict):
            continue
        db.add(
            DetectionReasoningEdge(
                submission_id=submission_id,
                result_id=result_id,
                edge_key=str(item.get("edge_key") or ""),
                source_key=str(item.get("source_key") or ""),
                target_key=str(item.get("target_key") or ""),
                relation_type=str(item.get("relation_type") or "") or None,
                tone=str(item.get("tone") or "") or None,
                weight=float(item.get("weight") or 0.0),
                detail=str(item.get("detail") or "") or None,
            )
        )

    db.commit()
