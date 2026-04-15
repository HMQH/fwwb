"""检测路由：提交、轮询任务、历史记录、详情。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.domain.detection import service as detection_service
from app.domain.detection.kinds import UploadKind
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.schemas.detections import (
    DetectionHistoryItemResponse,
    DetectionJobResponse,
    DetectionSubmissionDetailResponse,
    DetectionSubmitAcceptedResponse,
)

router = APIRouter(prefix="/api/detections", tags=["detections"])


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
        s = value.strip()
        return s if s else None
    return None


def _form_uuid(value: object | None) -> uuid.UUID | None:
    normalized = _form_str(value)
    if not normalized:
        return None
    try:
        return uuid.UUID(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="关系对象参数无效") from exc


@router.post(
    "/submit",
    response_model=DetectionSubmitAcceptedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_detection(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionSubmitAcceptedResponse:
    max_b = settings.max_upload_bytes
    form = await request.form()

    text_content = _form_str(form.get("text_content"))
    relation_profile_id = _form_uuid(form.get("relation_profile_id"))
    bundles: dict[UploadKind, list[tuple[bytes, str]]] = {
        "text": await _collect_uploads(form, "text_files", max_bytes=max_b),
        "audio": await _collect_uploads(form, "audio_files", max_bytes=max_b),
        "image": await _collect_uploads(form, "image_files", max_bytes=max_b),
        "video": await _collect_uploads(form, "video_files", max_bytes=max_b),
    }

    submission, job = detection_service.submit_detection(
        db,
        user_id=current.id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=max_b,
        text_content=text_content,
        relation_profile_id=relation_profile_id,
        file_bundles=bundles,
    )
    if settings.detection_background_on_submit:
        background_tasks.add_task(detection_service.process_job_in_new_session, job.id)
    return DetectionSubmitAcceptedResponse.model_validate(
        {
            "submission": detection_service.build_submission_payload(db, submission),
            "job": detection_service.get_job_detail(db, user_id=current.id, job_id=job.id),
        }
    )


@router.get("/jobs/{job_id}", response_model=DetectionJobResponse)
def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionJobResponse:
    detail = detection_service.get_job_detail(db, user_id=current.id, job_id=job_id)
    return DetectionJobResponse.model_validate(detail)


@router.get("/submissions", response_model=list[DetectionHistoryItemResponse])
def list_history(
    limit: int = Query(default=settings.detection_history_limit_default, ge=1, le=settings.detection_history_limit_max),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[DetectionHistoryItemResponse]:
    items = detection_service.list_history(db, user_id=current.id, limit=limit)
    return [DetectionHistoryItemResponse.model_validate(item) for item in items]


@router.get("/submissions/{submission_id}", response_model=DetectionSubmissionDetailResponse)
def get_submission_detail(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionSubmissionDetailResponse:
    detail = detection_service.get_submission_detail(
        db,
        user_id=current.id,
        submission_id=submission_id,
    )
    return DetectionSubmissionDetailResponse.model_validate(detail)


def _form_uuid(value: object | None) -> uuid.UUID | None:
    normalized = _form_str(value)
    if not normalized:
        return None
    try:
        return uuid.UUID(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="关系对象参数无效") from exc


@router.post("/submissions/{submission_id}/run", response_model=DetectionJobResponse)
def rerun_submission(
    submission_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionJobResponse:
    job = detection_service.rerun_submission(
        db,
        user_id=current.id,
        submission_id=submission_id,
    )
    background_tasks.add_task(detection_service.process_job_in_new_session, job.id)
    detail = detection_service.get_job_detail(db, user_id=current.id, job_id=job.id)
    return DetectionJobResponse.model_validate(detail)
