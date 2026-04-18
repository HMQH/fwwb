"""用户基础：注册、登录等业务。"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.user import repository as user_repository
from app.domain.user.entity import User, UserPushToken
from app.shared.core.config import settings
from app.shared.core.security import create_access_token, hash_password, verify_password
from app.shared.schemas.auth import (
    LoginRequest,
    PushTokenResponse,
    RegisterPushTokenRequest,
    RegisterRequest,
    TokenResponse,
    UpdateGuardianRequest,
    UserPublic,
)
from app.shared.storage.upload_paths import (
    resolved_upload_root,
    safe_suffix,
    save_avatar_bytes,
)
from app.shared.user_roles import is_minor_role, normalize_user_role

_EXPO_PUSH_TOKEN_RE = re.compile(r"^(Expo|Exponent)PushToken\[[^\]]+\]$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def role_from_birth_date(birth: date, today: date | None = None) -> str:
    """仅作年龄兜底，不代表完整人群画像。"""
    ref = today or date.today()
    age = ref.year - birth.year - ((ref.month, ref.day) < (birth.month, birth.day))
    if age < 18:
        return "minor"
    if age < 60:
        return "office_worker"
    return "elder"


def _user_public(u: User) -> UserPublic:
    return UserPublic(
        id=u.id,
        phone=u.phone,
        display_name=u.display_name,
        role=normalize_user_role(u.role) or u.role,
        birth_date=u.birth_date,
        avatar_url=u.avatar_url,
        guardian_relation=u.guardian_relation,
        profile_summary=u.profile_summary,
        safety_score=u.safety_score,
        memory_urgency_score=u.memory_urgency_score,
    )


def _default_guardian_relation(role: str) -> str:
    if is_minor_role(role):
        return "parent"
    return "self"


def register_user(
    db: Session,
    body: RegisterRequest,
    *,
    avatar_upload: tuple[bytes, str] | None = None,
    upload_root_cfg: str | None = None,
) -> TokenResponse:
    role = normalize_user_role(body.role) or body.role
    user_id = uuid.uuid4()
    avatar_url: str | None = None

    if avatar_upload and upload_root_cfg:
        upload_root = resolved_upload_root(upload_root_cfg)
        upload_root.mkdir(parents=True, exist_ok=True)
        avatar_bytes, avatar_name = avatar_upload
        avatar_url = save_avatar_bytes(
            upload_root=upload_root,
            user_id=user_id,
            data=avatar_bytes,
            suffix=safe_suffix(avatar_name, ".png"),
        )

    user = User(
        id=user_id,
        phone=body.phone,
        password_hash=hash_password(body.password),
        birth_date=body.birth_date,
        role=role,
        display_name=body.display_name.strip(),
        avatar_url=avatar_url,
        guardian_relation=_default_guardian_relation(role),
        profile_summary=None,
        safety_score=settings.user_profile_default_safety_score,
        memory_urgency_score=0,
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


def update_guardian(
    db: Session,
    *,
    current_user: User,
    body: UpdateGuardianRequest,
) -> UserPublic:
    current_user.guardian_relation = body.guardian_relation
    user_repository.save(db, current_user)
    return _user_public(current_user)


def update_avatar(
    db: Session,
    *,
    current_user: User,
    avatar_upload: tuple[bytes, str],
    upload_root_cfg: str,
) -> UserPublic:
    upload_root = resolved_upload_root(upload_root_cfg)
    avatar_bytes, avatar_name = avatar_upload
    avatar_url = save_avatar_bytes(
        upload_root=upload_root,
        user_id=current_user.id,
        data=avatar_bytes,
        suffix=safe_suffix(avatar_name, ".png"),
    )
    current_user.avatar_url = avatar_url
    user_repository.save(db, current_user)
    return _user_public(current_user)


def register_push_token(
    db: Session,
    *,
    current_user: User,
    body: RegisterPushTokenRequest,
) -> PushTokenResponse:
    token_value = body.expo_push_token.strip()
    if not _EXPO_PUSH_TOKEN_RE.match(token_value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="推送令牌无效",
        )

    device_name = (body.device_name or "").strip() or None
    row = user_repository.get_push_token_by_value(db, token_value)
    if row is None:
        row = UserPushToken(
            user_id=current_user.id,
            expo_push_token=token_value,
            platform=body.platform,
            device_name=device_name,
            is_active=True,
            last_seen_at=_utcnow(),
        )
    else:
        row.user_id = current_user.id
        row.platform = body.platform
        row.device_name = device_name
        row.is_active = True
        row.last_seen_at = _utcnow()

    saved = user_repository.save_push_token(db, row)
    return PushTokenResponse(
        expo_push_token=saved.expo_push_token,
        platform=saved.platform,  # type: ignore[arg-type]
        device_name=saved.device_name,
        is_active=saved.is_active,
    )
