"""认证路由：注册、登录、当前用户。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.domain.user import service as user_service
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UpdateGuardianRequest,
    UserPublic,
)
from app.shared.storage.file_validation import validate_filename_for_kind

router = APIRouter(prefix="/api", tags=["auth"])


def _normalize_bool(value: object | None) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


async def _read_optional_avatar(form: object) -> tuple[bytes, str] | None:
    candidate = getattr(form, "get", lambda _key: None)("avatar_file")
    if not isinstance(candidate, UploadFile):
        return None

    filename = (candidate.filename or "").strip()
    if not filename:
        return None

    validate_filename_for_kind(filename, "image")
    data = await candidate.read()
    if not data:
        return None
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件过大（>{settings.max_upload_bytes} 字节）",
        )
    return data, filename


async def _parse_register_payload(request: Request) -> tuple[RegisterRequest, tuple[bytes, str] | None]:
    content_type = request.headers.get("content-type", "")
    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            payload = RegisterRequest(
                phone=str(form.get("phone", "")).strip(),
                password=str(form.get("password", "")),
                password_confirm=str(form.get("password_confirm", "")),
                birth_date=str(form.get("birth_date", "")).strip(),
                display_name=str(form.get("display_name", "")).strip(),
                role=str(form.get("role", "")).strip(),
                agree_terms=_normalize_bool(form.get("agree_terms")),
            )
            avatar_upload = await _read_optional_avatar(form)
            return payload, avatar_upload

        payload = RegisterRequest.model_validate(await request.json())
        return payload, None
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc


@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    payload, avatar_upload = await _parse_register_payload(request)
    return user_service.register_user(
        db,
        payload,
        avatar_upload=avatar_upload,
        upload_root_cfg=settings.upload_root,
    )


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return user_service.login_user(db, body)


@router.get("/me", response_model=UserPublic)
def me(current: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(current)


@router.patch("/me/guardian", response_model=UserPublic)
def update_guardian(
    body: UpdateGuardianRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserPublic:
    return user_service.update_guardian(db, current_user=current, body=body)


@router.post("/me/avatar", response_model=UserPublic)
async def upload_me_avatar(
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserPublic:
    """multipart：字段名 avatar_file，图片格式与注册头像一致。"""
    form = await request.form()
    avatar_upload = await _read_optional_avatar(form)
    if not avatar_upload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传头像图片（字段名 avatar_file）",
        )
    return user_service.update_avatar(
        db,
        current_user=current,
        avatar_upload=avatar_upload,
        upload_root_cfg=settings.upload_root,
    )
