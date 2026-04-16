"""Relation routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.domain.relations import service as relation_service
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.schemas.relations import (
    RelationDetailResponse,
    RelationMemoryCreateRequest,
    RelationMemoryResponse,
    RelationMemoryUpdateRequest,
    RelationProfileCreateRequest,
    RelationProfileSummaryResponse,
    RelationProfileUpdateRequest,
)
from app.shared.storage.file_validation import validate_filename_for_kind

router = APIRouter(prefix="/api/relations", tags=["relations"])


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
            detail=f"文件过大，超过 {settings.max_upload_bytes} 字节限制",
        )
    return data, filename


@router.get("", response_model=list[RelationProfileSummaryResponse])
def list_relations(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[RelationProfileSummaryResponse]:
    items = relation_service.list_profiles(db, user_id=current.id)
    return [RelationProfileSummaryResponse.model_validate(item) for item in items]


@router.post("", response_model=RelationProfileSummaryResponse)
def create_relation(
    body: RelationProfileCreateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationProfileSummaryResponse:
    item = relation_service.create_profile(
        db,
        user_id=current.id,
        relation_type=body.relation_type,
        name=body.name,
        description=body.description,
        tags=body.tags,
    )
    return RelationProfileSummaryResponse.model_validate(item)


@router.patch("/{relation_id}", response_model=RelationProfileSummaryResponse)
def update_relation(
    relation_id: uuid.UUID,
    body: RelationProfileUpdateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationProfileSummaryResponse:
    item = relation_service.update_profile(
        db,
        user_id=current.id,
        relation_id=relation_id,
        relation_type=body.relation_type,
        name=body.name,
        description=body.description,
        tags=body.tags,
    )
    return RelationProfileSummaryResponse.model_validate(item)


@router.post("/{relation_id}/avatar", response_model=RelationProfileSummaryResponse)
async def upload_relation_avatar(
    relation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationProfileSummaryResponse:
    form = await request.form()
    avatar_upload = await _read_optional_avatar(form)
    if not avatar_upload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传头像图片（字段名 avatar_file）",
        )
    item = relation_service.update_avatar(
        db,
        user_id=current.id,
        relation_id=relation_id,
        avatar_upload=avatar_upload,
        upload_root_cfg=settings.upload_root,
    )
    return RelationProfileSummaryResponse.model_validate(item)


@router.get("/{relation_id}", response_model=RelationDetailResponse)
def get_relation_detail(
    relation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationDetailResponse:
    detail = relation_service.get_profile_detail(db, user_id=current.id, relation_id=relation_id)
    return RelationDetailResponse.model_validate(detail)


@router.post("/{relation_id}/memories", response_model=RelationMemoryResponse)
def create_relation_memory(
    relation_id: uuid.UUID,
    body: RelationMemoryCreateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationMemoryResponse:
    item = relation_service.create_memory(
        db,
        user_id=current.id,
        relation_id=relation_id,
        memory_scope=body.memory_scope,
        memory_kind=body.memory_kind,
        title=body.title,
        content=body.content,
    )
    return RelationMemoryResponse.model_validate(item)


@router.patch("/{relation_id}/memories/{memory_id}", response_model=RelationMemoryResponse)
def update_relation_memory_scope(
    relation_id: uuid.UUID,
    memory_id: uuid.UUID,
    body: RelationMemoryUpdateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> RelationMemoryResponse:
    item = relation_service.update_memory_scope(
        db,
        user_id=current.id,
        relation_id=relation_id,
        memory_id=memory_id,
        memory_scope=body.memory_scope,
    )
    return RelationMemoryResponse.model_validate(item)
