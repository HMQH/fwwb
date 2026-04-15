"""反诈助手路由。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.domain.assistant import service as assistant_service
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.schemas.assistant import (
    AssistantConversationTurnResponse,
    AssistantSendMessageRequest,
    AssistantSessionCreateRequest,
    AssistantSessionDetailResponse,
    AssistantSessionResponse,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


async def _collect_uploads(form: object, key: str, *, max_bytes: int) -> list[tuple[bytes, str]]:
    getlist = getattr(form, "getlist", None)
    if getlist is None:
        return []
    result: list[tuple[bytes, str]] = []
    for item in getlist(key):
        if not isinstance(item, UploadFile):
            continue
        name = (item.filename or "").strip()
        if not name:
            continue
        data = await item.read()
        if not data:
            continue
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"文件过大，超过 {max_bytes} 字节限制",
            )
        result.append((data, name))
    return result


def _form_str(value: object | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _form_uuid(value: object | None) -> uuid.UUID | None:
    cleaned = _form_str(value)
    if not cleaned:
        return None
    try:
        return uuid.UUID(cleaned)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="relation_profile_id 格式错误") from exc


@router.get("/sessions", response_model=list[AssistantSessionResponse])
def list_sessions(
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[AssistantSessionResponse]:
    items = assistant_service.list_sessions(db, user_id=current.id, limit=limit)
    return [AssistantSessionResponse.model_validate(item) for item in items]


@router.post("/sessions", response_model=AssistantSessionDetailResponse)
def create_session(
    body: AssistantSessionCreateRequest | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AssistantSessionDetailResponse:
    payload = body or AssistantSessionCreateRequest()
    detail = assistant_service.create_session(
        db,
        user_id=current.id,
        relation_profile_id=payload.relation_profile_id,
        source_submission_id=payload.source_submission_id,
        title=payload.title,
    )
    return AssistantSessionDetailResponse.model_validate(detail)


@router.get("/sessions/{session_id}", response_model=AssistantSessionDetailResponse)
def get_session_detail(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AssistantSessionDetailResponse:
    detail = assistant_service.get_session_detail(db, user_id=current.id, session_id=session_id)
    return AssistantSessionDetailResponse.model_validate(detail)


@router.post("/sessions/{session_id}/messages", response_model=AssistantConversationTurnResponse)
def send_message(
    session_id: uuid.UUID,
    body: AssistantSendMessageRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AssistantConversationTurnResponse:
    detail = assistant_service.send_message(
        db,
        user_id=current.id,
        session_id=session_id,
        content=body.content,
        relation_profile_id=body.relation_profile_id,
    )
    return AssistantConversationTurnResponse.model_validate(detail)


@router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> StreamingResponse:
    content_type = (request.headers.get("content-type") or "").lower()
    content: str | None
    relation_profile_id: uuid.UUID | None
    file_bundles: dict[str, list[tuple[bytes, str]]]

    if "multipart/form-data" in content_type:
        form = await request.form()
        content = _form_str(form.get("content"))
        relation_profile_id = _form_uuid(form.get("relation_profile_id"))
        file_bundles = {
            "text": await _collect_uploads(form, "text_files", max_bytes=settings.max_upload_bytes),
            "audio": await _collect_uploads(form, "audio_files", max_bytes=settings.max_upload_bytes),
            "image": await _collect_uploads(form, "image_files", max_bytes=settings.max_upload_bytes),
            "video": await _collect_uploads(form, "video_files", max_bytes=settings.max_upload_bytes),
        }
    else:
        payload = AssistantSendMessageRequest.model_validate(await request.json())
        content = payload.content
        relation_profile_id = payload.relation_profile_id
        file_bundles = {
            "text": [],
            "audio": [],
            "image": [],
            "video": [],
        }

    stream = assistant_service.stream_message(
        db,
        user_id=current.id,
        session_id=session_id,
        content=content,
        relation_profile_id=relation_profile_id,
        file_bundles=file_bundles,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
