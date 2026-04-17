"""通话干预数据访问。"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from app.domain.call_intervention.entity import (
    CallAsrSegment,
    CallRiskEvent,
    CallSession,
    PhoneRiskProfile,
)


def get_phone_risk_profile(db: Session, phone_number: str) -> PhoneRiskProfile | None:
    return db.get(PhoneRiskProfile, phone_number)


def save_phone_risk_profile(db: Session, profile: PhoneRiskProfile) -> PhoneRiskProfile:
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def create_call_session(db: Session, row: CallSession) -> CallSession:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_call_session(db: Session, row: CallSession) -> CallSession:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_call_session_by_id(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> CallSession | None:
    stmt = select(CallSession).where(
        CallSession.id == session_id,
        CallSession.user_id == user_id,
    )
    return db.execute(stmt).scalar_one_or_none()


def list_call_sessions(db: Session, *, user_id: uuid.UUID, limit: int = 20) -> list[CallSession]:
    stmt = (
        select(CallSession)
        .where(CallSession.user_id == user_id)
        .order_by(desc(CallSession.started_at), desc(CallSession.created_at))
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def create_asr_segment(db: Session, row: CallAsrSegment) -> CallAsrSegment:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_asr_segments(db: Session, *, session_id: uuid.UUID) -> list[CallAsrSegment]:
    stmt = (
        select(CallAsrSegment)
        .where(CallAsrSegment.session_id == session_id)
        .order_by(CallAsrSegment.seq.asc(), CallAsrSegment.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def delete_asr_segments(db: Session, *, session_id: uuid.UUID) -> None:
    db.execute(delete(CallAsrSegment).where(CallAsrSegment.session_id == session_id))
    db.commit()


def create_risk_event(db: Session, row: CallRiskEvent) -> CallRiskEvent:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_risk_events(db: Session, *, session_id: uuid.UUID) -> list[CallRiskEvent]:
    stmt = (
        select(CallRiskEvent)
        .where(CallRiskEvent.session_id == session_id)
        .order_by(CallRiskEvent.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def has_rule_hit(db: Session, *, session_id: uuid.UUID, matched_rule: str) -> bool:
    stmt = select(CallRiskEvent.id).where(
        CallRiskEvent.session_id == session_id,
        CallRiskEvent.matched_rule == matched_rule,
    )
    return db.execute(stmt).first() is not None
