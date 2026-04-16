from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.domain.guardians.entity import GuardianBinding, GuardianIntervention, GuardianRiskEvent


def _visibility_filter(*, user_id: uuid.UUID, phone: str):
    return or_(
        GuardianBinding.ward_user_id == user_id,
        GuardianBinding.guardian_user_id == user_id,
        GuardianBinding.guardian_phone == phone,
    )


def save_binding(db: Session, row: GuardianBinding) -> GuardianBinding:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_bindings_for_ward(db: Session, *, ward_user_id: uuid.UUID) -> list[GuardianBinding]:
    stmt = (
        select(GuardianBinding)
        .where(GuardianBinding.ward_user_id == ward_user_id)
        .order_by(GuardianBinding.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def list_bindings_visible_to_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    phone: str,
) -> list[GuardianBinding]:
    stmt = (
        select(GuardianBinding)
        .where(_visibility_filter(user_id=user_id, phone=phone))
        .order_by(GuardianBinding.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def get_binding_visible_to_user(
    db: Session,
    *,
    binding_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> GuardianBinding | None:
    stmt = (
        select(GuardianBinding)
        .where(GuardianBinding.id == binding_id)
        .where(_visibility_filter(user_id=user_id, phone=phone))
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def find_open_binding(
    db: Session,
    *,
    ward_user_id: uuid.UUID,
    guardian_phone: str,
    relation: str,
) -> GuardianBinding | None:
    stmt = (
        select(GuardianBinding)
        .where(GuardianBinding.ward_user_id == ward_user_id)
        .where(GuardianBinding.guardian_phone == guardian_phone)
        .where(GuardianBinding.relation == relation)
        .where(GuardianBinding.status.in_(("pending", "active")))
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_active_bindings_for_ward(db: Session, *, ward_user_id: uuid.UUID) -> list[GuardianBinding]:
    stmt = (
        select(GuardianBinding)
        .where(GuardianBinding.ward_user_id == ward_user_id)
        .where(GuardianBinding.status == "active")
        .order_by(GuardianBinding.is_primary.desc(), GuardianBinding.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def save_event(db: Session, row: GuardianRiskEvent) -> GuardianRiskEvent:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_event_for_binding_result(
    db: Session,
    *,
    guardian_binding_id: uuid.UUID,
    detection_result_id: uuid.UUID | None,
) -> GuardianRiskEvent | None:
    if detection_result_id is None:
        return None
    stmt = (
        select(GuardianRiskEvent)
        .where(GuardianRiskEvent.guardian_binding_id == guardian_binding_id)
        .where(GuardianRiskEvent.detection_result_id == detection_result_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_events_visible_to_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    phone: str,
    limit: int,
) -> list[tuple[GuardianRiskEvent, GuardianBinding]]:
    stmt = (
        select(GuardianRiskEvent, GuardianBinding)
        .join(GuardianBinding, GuardianBinding.id == GuardianRiskEvent.guardian_binding_id)
        .where(_visibility_filter(user_id=user_id, phone=phone))
        .order_by(GuardianRiskEvent.created_at.desc())
        .limit(limit)
    )
    return [(event, binding) for event, binding in db.execute(stmt).all()]


def get_event_visible_to_user(
    db: Session,
    *,
    event_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> tuple[GuardianRiskEvent, GuardianBinding] | None:
    stmt = (
        select(GuardianRiskEvent, GuardianBinding)
        .join(GuardianBinding, GuardianBinding.id == GuardianRiskEvent.guardian_binding_id)
        .where(GuardianRiskEvent.id == event_id)
        .where(_visibility_filter(user_id=user_id, phone=phone))
        .limit(1)
    )
    return db.execute(stmt).first()


def get_latest_event_for_submission_visible_to_user(
    db: Session,
    *,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> tuple[GuardianRiskEvent, GuardianBinding] | None:
    stmt = (
        select(GuardianRiskEvent, GuardianBinding)
        .join(GuardianBinding, GuardianBinding.id == GuardianRiskEvent.guardian_binding_id)
        .where(GuardianRiskEvent.submission_id == submission_id)
        .where(_visibility_filter(user_id=user_id, phone=phone))
        .order_by(GuardianRiskEvent.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).first()


def count_events_for_submission_visible_to_user(
    db: Session,
    *,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    phone: str,
) -> int:
    stmt = (
        select(GuardianRiskEvent.id)
        .join(GuardianBinding, GuardianBinding.id == GuardianRiskEvent.guardian_binding_id)
        .where(GuardianRiskEvent.submission_id == submission_id)
        .where(_visibility_filter(user_id=user_id, phone=phone))
    )
    return len(list(db.execute(stmt).scalars().all()))


def save_intervention(db: Session, row: GuardianIntervention) -> GuardianIntervention:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_interventions_for_event(db: Session, *, event_id: uuid.UUID) -> list[GuardianIntervention]:
    stmt = (
        select(GuardianIntervention)
        .where(GuardianIntervention.risk_event_id == event_id)
        .order_by(GuardianIntervention.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())
