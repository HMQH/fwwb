"""用户长期画像 MEMORY 路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.user import profile_memory as user_profile_memory
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.profile_memory import ProfileMemoryDocumentResponse

router = APIRouter(prefix="/api/profile-memory", tags=["profile-memory"])


@router.get("/me", response_model=ProfileMemoryDocumentResponse)
def get_my_profile_memory(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> ProfileMemoryDocumentResponse:
    payload = user_profile_memory.get_user_memory_document(db, user_id=current.id)
    return ProfileMemoryDocumentResponse.model_validate(payload)
