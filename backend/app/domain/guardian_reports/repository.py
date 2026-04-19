from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.domain.detection.entity import DetectionResult, DetectionSubmission
from app.domain.guardian_reports.entity import GuardianSafetyReport, GuardianSafetyReportAction, GuardianSafetyReportReceipt
from app.domain.guardians.entity import GuardianBinding


def _guardian_visibility_filter(*, user_id: uuid.UUID, phone: str):
    return or_(
        GuardianBinding.guardian_user_id == user_id,
        GuardianBinding.guardian_phone == phone,
    )


def save_report(db: Session, row: GuardianSafetyReport) -> GuardianSafetyReport:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_report_receipt(db: Session, row: GuardianSafetyReportReceipt) -> GuardianSafetyReportReceipt:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_report_action(db: Session, row: GuardianSafetyReportAction) -> GuardianSafetyReportAction:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_report_action_without_commit(db: Session, row: GuardianSafetyReportAction) -> None:
    db.add(row)


def commit_and_refresh_report(db: Session, row: GuardianSafetyReport) -> GuardianSafetyReport:
    db.commit()
    db.refresh(row)
    return row


def get_report(db: Session, *, report_id: uuid.UUID) -> GuardianSafetyReport | None:
    return db.get(GuardianSafetyReport, report_id)


def get_report_by_period(
    db: Session,
    *,
    ward_user_id: uuid.UUID,
    report_type: str,
    period_start: datetime,
    period_end: datetime,
) -> GuardianSafetyReport | None:
    stmt = (
        select(GuardianSafetyReport)
        .where(GuardianSafetyReport.ward_user_id == ward_user_id)
        .where(GuardianSafetyReport.report_type == report_type)
        .where(GuardianSafetyReport.period_start == period_start)
        .where(GuardianSafetyReport.period_end == period_end)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_reports_for_wards(
    db: Session,
    *,
    ward_user_ids: list[uuid.UUID],
    report_type: str | None,
    limit: int,
    offset: int,
) -> list[GuardianSafetyReport]:
    if not ward_user_ids:
        return []
    stmt = (
        select(GuardianSafetyReport)
        .where(GuardianSafetyReport.ward_user_id.in_(ward_user_ids))
        .order_by(GuardianSafetyReport.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if report_type:
        stmt = stmt.where(GuardianSafetyReport.report_type == report_type)
    return list(db.execute(stmt).scalars().all())


def list_receipts_for_report(db: Session, *, report_id: uuid.UUID) -> list[GuardianSafetyReportReceipt]:
    stmt = (
        select(GuardianSafetyReportReceipt)
        .where(GuardianSafetyReportReceipt.report_id == report_id)
        .order_by(GuardianSafetyReportReceipt.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def list_receipts_for_guardian_on_report(
    db: Session,
    *,
    report_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> list[GuardianSafetyReportReceipt]:
    stmt = (
        select(GuardianSafetyReportReceipt)
        .where(GuardianSafetyReportReceipt.report_id == report_id)
        .where(
            or_(
                GuardianSafetyReportReceipt.guardian_user_id == user_id,
                GuardianSafetyReportReceipt.guardian_phone == phone,
            )
        )
    )
    return list(db.execute(stmt).scalars().all())


def list_actions_for_report(db: Session, *, report_id: uuid.UUID) -> list[GuardianSafetyReportAction]:
    stmt = (
        select(GuardianSafetyReportAction)
        .where(GuardianSafetyReportAction.report_id == report_id)
        .order_by(
            GuardianSafetyReportAction.priority.asc(),
            GuardianSafetyReportAction.created_at.asc(),
        )
    )
    return list(db.execute(stmt).scalars().all())


def clear_actions_for_report(db: Session, *, report_id: uuid.UUID) -> None:
    db.execute(delete(GuardianSafetyReportAction).where(GuardianSafetyReportAction.report_id == report_id))
    db.commit()


def get_action_for_report(
    db: Session,
    *,
    report_id: uuid.UUID,
    action_id: uuid.UUID,
) -> GuardianSafetyReportAction | None:
    stmt = (
        select(GuardianSafetyReportAction)
        .where(GuardianSafetyReportAction.id == action_id)
        .where(GuardianSafetyReportAction.report_id == report_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def get_receipt_for_report_binding(
    db: Session,
    *,
    report_id: uuid.UUID,
    guardian_binding_id: uuid.UUID,
) -> GuardianSafetyReportReceipt | None:
    stmt = (
        select(GuardianSafetyReportReceipt)
        .where(GuardianSafetyReportReceipt.report_id == report_id)
        .where(GuardianSafetyReportReceipt.guardian_binding_id == guardian_binding_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def count_unread_receipts(db: Session, *, report_id: uuid.UUID) -> int:
    stmt = (
        select(func.count(GuardianSafetyReportReceipt.id))
        .where(GuardianSafetyReportReceipt.report_id == report_id)
        .where(GuardianSafetyReportReceipt.delivery_status != "read")
    )
    return int(db.execute(stmt).scalar() or 0)


def list_active_bindings_for_ward(db: Session, *, ward_user_id: uuid.UUID) -> list[GuardianBinding]:
    stmt = (
        select(GuardianBinding)
        .where(GuardianBinding.ward_user_id == ward_user_id)
        .where(GuardianBinding.status == "active")
        .order_by(GuardianBinding.is_primary.desc(), GuardianBinding.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def list_bindings_by_ids(db: Session, *, binding_ids: list[uuid.UUID]) -> list[GuardianBinding]:
    if not binding_ids:
        return []
    stmt = select(GuardianBinding).where(GuardianBinding.id.in_(binding_ids))
    return list(db.execute(stmt).scalars().all())


def list_accessible_ward_ids(
    db: Session,
    *,
    user_id: uuid.UUID,
    phone: str,
) -> list[uuid.UUID]:
    stmt = (
        select(GuardianBinding.ward_user_id)
        .where(GuardianBinding.status == "active")
        .where(_guardian_visibility_filter(user_id=user_id, phone=phone))
        .group_by(GuardianBinding.ward_user_id)
    )
    ward_ids = {ward_id for ward_id in db.execute(stmt).scalars().all() if ward_id is not None}
    ward_ids.add(user_id)
    return list(ward_ids)


def is_user_guardian_for_ward(
    db: Session,
    *,
    ward_user_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> bool:
    stmt = (
        select(GuardianBinding.id)
        .where(GuardianBinding.ward_user_id == ward_user_id)
        .where(GuardianBinding.status == "active")
        .where(_guardian_visibility_filter(user_id=user_id, phone=phone))
        .limit(1)
    )
    return db.execute(stmt).scalars().first() is not None


def list_latest_submission_result_rows(
    db: Session,
    *,
    ward_user_id: uuid.UUID,
    start_at: datetime,
    end_at: datetime,
) -> list[tuple[DetectionSubmission, DetectionResult | None]]:
    latest_result_sq = (
        select(
            DetectionResult.submission_id.label("submission_id"),
            func.max(DetectionResult.created_at).label("latest_created_at"),
        )
        .group_by(DetectionResult.submission_id)
        .subquery()
    )
    stmt = (
        select(DetectionSubmission, DetectionResult)
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
        .where(DetectionSubmission.user_id == ward_user_id)
        .where(DetectionSubmission.created_at >= start_at)
        .where(DetectionSubmission.created_at < end_at)
        .order_by(DetectionSubmission.created_at.asc())
    )
    return [(submission, result) for submission, result in db.execute(stmt).all()]
