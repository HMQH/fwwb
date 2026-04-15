"""反诈助手仓储。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.assistant.entity import AssistantMessage, AssistantSession


def save_session(db: Session, row: AssistantSession) -> AssistantSession:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_message(db: Session, row: AssistantMessage) -> AssistantMessage:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_session_for_user(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AssistantSession | None:
    stmt = (
        select(AssistantSession)
        .where(AssistantSession.id == session_id)
        .where(AssistantSession.user_id == user_id)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_sessions_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[AssistantSession]:
    stmt = (
        select(AssistantSession)
        .where(AssistantSession.user_id == user_id)
        .order_by(AssistantSession.updated_at.desc(), AssistantSession.created_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def list_messages_for_session(
    db: Session,
    *,
    session_id: uuid.UUID,
) -> list[AssistantMessage]:
    stmt = (
        select(AssistantMessage)
        .where(AssistantMessage.session_id == session_id)
        .order_by(AssistantMessage.created_at.asc(), AssistantMessage.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


def list_recent_messages_for_session(
    db: Session,
    *,
    session_id: uuid.UUID,
    limit: int,
) -> list[AssistantMessage]:
    stmt = (
        select(AssistantMessage)
        .where(AssistantMessage.session_id == session_id)
        .order_by(AssistantMessage.created_at.desc(), AssistantMessage.id.desc())
        .limit(limit)
    )
    items = list(db.execute(stmt).scalars().all())
    items.reverse()
    return items


def list_recent_messages_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    role: str | None = None,
) -> list[AssistantMessage]:
    stmt = select(AssistantMessage).where(AssistantMessage.user_id == user_id)
    if role:
        stmt = stmt.where(AssistantMessage.role == role)
    stmt = stmt.order_by(AssistantMessage.created_at.desc(), AssistantMessage.id.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())
