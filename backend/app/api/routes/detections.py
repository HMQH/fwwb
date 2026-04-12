"""多模态检测：提交一次检测材料。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.domain.detection import service as detection_service
from app.domain.detection.kinds import UploadKind
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.schemas.detections import SubmissionResponse
from app.shared.db.session import get_db

router = APIRouter(prefix="/api/detections", tags=["detections"])


async def _collect_uploads(form: object, key: str, *, max_bytes: int) -> list[tuple[bytes, str]]:
    """从 multipart 中读取同一字段名的多个文件。"""
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
                detail=f"文件过大（>{max_bytes} 字节）",
            )
        result.append((data, name))
    return result


def _form_str(value: object | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        return s if s else None
    return None


@router.post(
    "/submit",
    response_model=SubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_detection(
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> SubmissionResponse:
    """
    multipart/form-data：
    - text_content：可选字符串
    - text_files / audio_files / image_files / video_files：可重复多个文件（附录）
    存储路径：uploads/{user_id}/{UTC时间到秒}/[text|audio|visual|video]/...
    """
    max_b = settings.max_upload_bytes
    form = await request.form()

    tc = _form_str(form.get("text_content"))

    bundles: dict[UploadKind, list[tuple[bytes, str]]] = {
        "text": await _collect_uploads(form, "text_files", max_bytes=max_b),
        "audio": await _collect_uploads(form, "audio_files", max_bytes=max_b),
        "image": await _collect_uploads(form, "image_files", max_bytes=max_b),
        "video": await _collect_uploads(form, "video_files", max_bytes=max_b),
    }

    row = detection_service.create_submission(
        db,
        user_id=current.id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=max_b,
        text_content=tc,
        file_bundles=bundles,
    )
    return SubmissionResponse.model_validate(row)
