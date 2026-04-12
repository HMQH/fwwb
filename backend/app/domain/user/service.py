"""用户域：注册、登录等业务。"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.user import repository as user_repository
from app.domain.user.entity import User
from app.shared.core.security import create_access_token, hash_password, verify_password
from app.shared.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserPublic


def role_from_birth_date(birth: date, today: date | None = None) -> str:
    """周岁：<18 child；18–60 youth；>60 elder（含边界与开发文档一致）。"""
    ref = today or date.today()
    age = ref.year - birth.year - ((ref.month, ref.day) < (birth.month, birth.day))
    if age < 18:
        return "child"
    if age <= 60:
        return "youth"
    return "elder"


def _user_public(u: User) -> UserPublic:
    return UserPublic(
        id=u.id,
        phone=u.phone,
        display_name=u.display_name,
        role=u.role,
        birth_date=u.birth_date,
    )


def register_user(db: Session, body: RegisterRequest) -> TokenResponse:
    role = role_from_birth_date(body.birth_date)
    user = User(
        phone=body.phone,
        password_hash=hash_password(body.password),
        birth_date=body.birth_date,
        role=role,
        display_name=body.display_name.strip(),
    )
    try:
        user_repository.save(db, user)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该手机号已注册",
        ) from exc
    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=_user_public(user))


def login_user(db: Session, body: LoginRequest) -> TokenResponse:
    row = user_repository.get_by_phone(db, body.phone)
    if row is None or not verify_password(body.password, row.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="手机号或密码错误",
        )
    token = create_access_token(row.id)
    return TokenResponse(access_token=token, user=_user_public(row))
