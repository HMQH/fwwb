"""AI 换脸识别路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.ai_face.service import detect_ai_face_and_store
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.ai_face import AIFaceCheckResponse

router = APIRouter(tags=["ai-face"])


@router.post("/api/detections/ai-face/check", response_model=AIFaceCheckResponse)
@router.post("/api/ai-face/check", response_model=AIFaceCheckResponse, include_in_schema=False)
async def check_ai_face(
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AIFaceCheckResponse:
    data = await image_file.read()
    try:
        result = detect_ai_face_and_store(
            db,
            user_id=current.id,
            image_bytes=data,
            filename=image_file.filename,
            content_type=image_file.content_type,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return AIFaceCheckResponse.model_validate(result)
