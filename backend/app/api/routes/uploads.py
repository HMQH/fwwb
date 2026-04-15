"""上传记录路由。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.uploads import service as upload_service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.uploads import AssignUploadRequest, UserUploadResponse

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.get("", response_model=list[UserUploadResponse])
def list_uploads(
    limit: int = Query(default=120, ge=1, le=500),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[UserUploadResponse]:
    items = upload_service.list_uploads(db, user_id=current.id, limit=limit)
    return [UserUploadResponse.model_validate(item) for item in items]


@router.post("/{upload_id}/assign", response_model=UserUploadResponse)
def assign_upload(
    upload_id: uuid.UUID,
    body: AssignUploadRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserUploadResponse:
    item = upload_service.assign_upload_to_relation(
        db,
        user_id=current.id,
        upload_id=upload_id,
        relation_profile_id=body.relation_profile_id,
        file_paths=body.file_paths,
        memory_scope=body.memory_scope,
    )
    return UserUploadResponse.model_validate(item)
