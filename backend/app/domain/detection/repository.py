"""检测任务持久化。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.detection.entity import DetectionJob, DetectionResult, DetectionSubmission


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
) -> list[DetectionSubmission]:
    stmt = (
        select(DetectionSubmission)
        .where(DetectionSubmission.user_id == user_id)
        .order_by(DetectionSubmission.created_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


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
