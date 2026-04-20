"""用户数据访问。"""
from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.user.entity import User, UserPushToken

_USER_ADMIN_SCHEMA_READY = False


def ensure_user_admin_schema(db: Session) -> None:
    global _USER_ADMIN_SCHEMA_READY
    if _USER_ADMIN_SCHEMA_READY:
        return

    statements = [
        """
        ALTER TABLE public.users
          ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_users_is_admin_true
          ON public.users (is_admin)
        """,
    ]
    for statement in statements:
        db.execute(text(statement))
    db.commit()
    _USER_ADMIN_SCHEMA_READY = True


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    ensure_user_admin_schema(db)
    return db.get(User, user_id)


def get_by_phone(db: Session, phone: str) -> User | None:
    ensure_user_admin_schema(db)
    return db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()


def save(db: Session, user: User) -> User:
    ensure_user_admin_schema(db)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(user)
    return user


def get_push_token_by_value(db: Session, expo_push_token: str) -> UserPushToken | None:
    ensure_user_admin_schema(db)
    stmt = select(UserPushToken).where(UserPushToken.expo_push_token == expo_push_token).limit(1)
    return db.execute(stmt).scalars().first()


def list_active_push_tokens_for_user(db: Session, *, user_id: uuid.UUID) -> list[UserPushToken]:
    ensure_user_admin_schema(db)
    stmt = (
        select(UserPushToken)
        .where(UserPushToken.user_id == user_id)
        .where(UserPushToken.is_active.is_(True))
        .order_by(UserPushToken.updated_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def save_push_token(db: Session, row: UserPushToken) -> UserPushToken:
    ensure_user_admin_schema(db)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(row)
    return row
