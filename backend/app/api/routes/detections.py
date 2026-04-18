"""检测路由：提交、轮询任务、历史记录、详情。"""
from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.agent.skills.impersonation_checker import run_impersonation_checker
from app.domain.agent.skills.ocr_phishing import run_ocr_phishing
from app.domain.agent.skills.official_document_checker import run_official_document_checker
from app.domain.agent.skills.pii_guard import run_pii_guard
from app.domain.agent.skills.qr_inspector import run_qr_inspector
from app.domain.agent.tools.ocr_tool import extract_texts
from app.domain.detection import service as detection_service
from app.domain.detection.audio_detector import (
    AudioDecodeError,
    AudioDetectorNotReadyError,
    create_batch_job as create_audio_verify_batch_job,
    create_job as create_audio_verify_job,
    ensure_batch_job_owner as ensure_audio_verify_batch_job_owner,
    ensure_job_owner as ensure_audio_verify_job_owner,
    predict_file,
    process_batch_job as process_audio_verify_batch_job,
    process_job as process_audio_verify_job,
    write_upload_to_temp,
)
from app.domain.detection.kinds import UploadKind
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.schemas.audio_verify import (
    AudioVerifyBatchJobResponse,
    AudioVerifyBatchJobSubmitResponse,
    AudioVerifyJobResponse,
    AudioVerifyJobSubmitResponse,
    AudioVerifyResponse,
    AudioVerifyUploadsSubmitRequest,
)
from app.shared.schemas.detections import (
    DetectionHistoryItemResponse,
    DetectionHistoryStatisticsResponse,
    DetectionJobResponse,
    DetectionSubmissionDetailResponse,
    DetectionSubmitAcceptedResponse,
    DirectImageSkillCheckResponse,
    WebPhishingDetectRequest,
    WebPhishingDetectResponse,
)

router = APIRouter(prefix="/api/detections", tags=["detections"])


async def _collect_uploads(form: object, key: str, *, max_bytes: int) -> list[tuple[bytes, str]]:
    getlist = getattr(form, "getlist", None)
    if getlist is None:
        return []
    result: list[tuple[bytes, str]] = []
    for item in getlist(key):
        if not isinstance(item, (UploadFile, StarletteUploadFile)):
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


def _form_bool(value: object | None) -> bool | None:
    normalized = _form_str(value)
    if normalized is None:
        return None
    return normalized.lower() in {"1", "true", "yes", "on"}


def _form_analysis_mode(value: object | None) -> str | None:
    normalized = _form_str(value)
    if normalized is None:
        return None
    lowered = normalized.lower()
    if lowered in {"deep", "standard"}:
        return lowered
    return None


def _read_audio_upload(audio_file: UploadFile) -> tuple[str, str]:
    filename = (audio_file.filename or "").strip()
    suffix = Path(filename.lower()).suffix or ".wav"
    return filename, suffix


def _read_image_upload(image_file: UploadFile) -> tuple[str, str]:
    filename = (image_file.filename or "").strip()
    suffix = Path(filename.lower()).suffix or ".jpg"
    return filename, suffix


def _decode_text_bytes(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="HTML 文件编码无法识别，请优先使用 UTF-8 或 GB18030 编码。",
    )


async def _read_html_upload(html_file: UploadFile | None, *, max_bytes: int) -> str | None:
    if html_file is None:
        return None
    filename = (html_file.filename or "").strip()
    suffix = Path(filename.lower()).suffix
    if suffix and suffix not in {".html", ".htm", ".txt"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持上传 .html / .htm / .txt 文件作为网页源码。",
        )
    data = await html_file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传的 HTML 文件为空")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"HTML 文件过大，超过 {max_bytes} 字节限制",
        )
    return _decode_text_bytes(data)


def _extract_direct_skill_result(payload: dict[str, Any], result_key: str) -> dict[str, Any]:
    result = payload.get(result_key)
    if not isinstance(result, dict):
        raise RuntimeError(f"专项检测返回结构缺少 {result_key}")
    return result


async def _run_direct_image_skill(
    *,
    db: Session,
    current: User,
    image_file: UploadFile,
    kind: str,
    result_key: str,
    runner: Callable[[dict[str, Any]], dict[str, Any]],
    with_ocr: bool = False,
) -> DirectImageSkillCheckResponse:
    _ = current
    filename, suffix = _read_image_upload(image_file)
    data = await image_file.read()

    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="空图片文件")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"图片文件过大，超过 {settings.max_upload_bytes} 字节限制",
        )

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            temp_path = Path(tmp.name)

        state: dict[str, Any] = {
            "image_paths": [str(temp_path)],
            "text_content": None,
        }
        if with_ocr:
            state["ocr_result"] = {
                "raw": extract_texts(image_paths=[str(temp_path)], fallback_text=None),
            }

        payload = runner(state)
        result = _extract_direct_skill_result(payload, result_key)
        record_refs = detection_service.persist_direct_image_skill_result(
            db,
            user_id=current.id,
            image_bytes=data,
            filename=filename or None,
            kind=kind,
            result_key=result_key,
            result=result,
            with_ocr=with_ocr,
        )
        return DirectImageSkillCheckResponse.model_validate(
            {
                "kind": kind,
                "image_name": filename or None,
                "result": result,
                **record_refs,
            }
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"专项检测失败：{type(exc).__name__}: {exc}",
        ) from exc
    finally:
        if temp_path is not None:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass


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
    requested_analysis_mode = _form_analysis_mode(form.get("analysis_mode"))
    deep_reasoning = _form_bool(form.get("deep_reasoning"))
    if requested_analysis_mode is not None:
        deep_reasoning = requested_analysis_mode == "deep"
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
        deep_reasoning=deep_reasoning,
        file_bundles=bundles,
    )
    if settings.detection_background_on_submit and job.status == "pending":
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
    offset: int = Query(default=0, ge=0),
    scope: str = Query(default="month"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[DetectionHistoryItemResponse]:
    items = detection_service.list_history(
        db,
        user_id=current.id,
        limit=limit,
        offset=offset,
        scope=scope,
    )
    return [DetectionHistoryItemResponse.model_validate(item) for item in items]


@router.get("/submissions/statistics", response_model=DetectionHistoryStatisticsResponse)
def get_history_statistics(
    scope: str = Query(default="month"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionHistoryStatisticsResponse:
    detail = detection_service.get_history_statistics(db, user_id=current.id, scope=scope)
    return DetectionHistoryStatisticsResponse.model_validate(detail)


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
    if job.status == "pending":
        background_tasks.add_task(detection_service.process_job_in_new_session, job.id)
    detail = detection_service.get_job_detail(db, user_id=current.id, job_id=job.id)
    return DetectionJobResponse.model_validate(detail)


@router.post("/audio/verify", response_model=AudioVerifyResponse)
async def verify_audio(
    current: User = Depends(get_current_user),
    audio_file: UploadFile = File(...),
) -> AudioVerifyResponse:
    _ = current
    _, suffix = _read_audio_upload(audio_file)
    data = await audio_file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="空音频文件")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"音频文件过大，超过 {settings.max_upload_bytes} 字节限制",
        )

    tmp_path = write_upload_to_temp(data, suffix)
    try:
        try:
            result = predict_file(tmp_path)
        except AudioDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except AudioDetectorNotReadyError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        return AudioVerifyResponse.model_validate(result)
    finally:
        try:
            if Path(tmp_path).exists():
                Path(tmp_path).unlink()
        except OSError:
            pass


@router.post("/audio/verify/submit", response_model=AudioVerifyJobSubmitResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_verify_audio(
    background_tasks: BackgroundTasks,
    current: User = Depends(get_current_user),
    audio_file: UploadFile = File(...),
) -> AudioVerifyJobSubmitResponse:
    filename, suffix = _read_audio_upload(audio_file)
    data = await audio_file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="空音频文件")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"音频文件过大，超过 {settings.max_upload_bytes} 字节限制",
        )

    tmp_path = write_upload_to_temp(data, suffix)
    job = create_audio_verify_job(user_id=current.id, filename=filename or None)
    background_tasks.add_task(process_audio_verify_job, job["job_id"], tmp_path)
    return AudioVerifyJobSubmitResponse.model_validate(job)


@router.get("/audio/verify/jobs/{job_id}", response_model=AudioVerifyJobResponse)
def get_audio_verify_job(
    job_id: uuid.UUID,
    current: User = Depends(get_current_user),
) -> AudioVerifyJobResponse:
    job = ensure_audio_verify_job_owner(job_id, current.id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到该音频鉴伪任务")
    return AudioVerifyJobResponse.model_validate(job)


@router.post(
    "/audio/verify/batch/submit",
    response_model=AudioVerifyBatchJobSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_verify_audio_batch(
    background_tasks: BackgroundTasks,
    current: User = Depends(get_current_user),
    audio_files: list[UploadFile] = File(...),
) -> AudioVerifyBatchJobSubmitResponse:
    if not audio_files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少上传一个音频文件")

    filenames: list[str | None] = []
    temp_paths: list[str] = []

    try:
        for audio_file in audio_files:
            filename, suffix = _read_audio_upload(audio_file)
            data = await audio_file.read()
            if not data:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="存在空音频文件")
            if len(data) > settings.max_upload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"音频文件过大，超过 {settings.max_upload_bytes} 字节限制",
                )

            temp_paths.append(write_upload_to_temp(data, suffix))
            filenames.append(filename or None)

        batch_job = create_audio_verify_batch_job(user_id=current.id, filenames=filenames)
        background_tasks.add_task(
            process_audio_verify_batch_job,
            batch_job["batch_id"],
            [
                (item["item_id"], temp_path)
                for item, temp_path in zip(batch_job["items"], temp_paths, strict=False)
            ],
        )
        return AudioVerifyBatchJobSubmitResponse.model_validate(batch_job)
    except Exception:
        for temp_path in temp_paths:
            try:
                if Path(temp_path).exists():
                    Path(temp_path).unlink()
            except OSError:
                pass
        raise


@router.get("/audio/verify/batch/jobs/{batch_id}", response_model=AudioVerifyBatchJobResponse)
def get_audio_verify_batch_job(
    batch_id: uuid.UUID,
    current: User = Depends(get_current_user),
) -> AudioVerifyBatchJobResponse:
    batch_job = ensure_audio_verify_batch_job_owner(batch_id, current.id)
    if batch_job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到该批量音频鉴伪任务")
    return AudioVerifyBatchJobResponse.model_validate(batch_job)


@router.post(
    "/audio/verify/records/submit-from-uploads",
    response_model=DetectionSubmitAcceptedResponse,
    status_code=status.HTTP_201_CREATED,
)
def submit_verify_audio_from_uploads(
    body: AudioVerifyUploadsSubmitRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> DetectionSubmitAcceptedResponse:
    submission, job = detection_service.submit_audio_verify_from_upload_paths(
        db,
        user_id=current.id,
        relation_profile_id=body.relation_profile_id,
        audio_paths=body.audio_paths,
    )
    if settings.detection_background_on_submit and job.status == "pending":
        background_tasks.add_task(detection_service.process_job_in_new_session, job.id)
    return DetectionSubmitAcceptedResponse.model_validate(
        {
            "submission": detection_service.build_submission_payload(db, submission),
            "job": detection_service.get_job_detail(db, user_id=current.id, job_id=job.id),
        }
    )


@router.post("/web/phishing/predict", response_model=WebPhishingDetectResponse)
@router.post("/web/phishing", response_model=WebPhishingDetectResponse, include_in_schema=False)
def detect_web_phishing(
    payload: WebPhishingDetectRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> WebPhishingDetectResponse:
    _ = current
    result = detection_service.detect_web_phishing(
        url=payload.url,
        html=payload.html,
        return_features=payload.return_features,
    )
    result.update(
        detection_service.persist_web_phishing_result(
            db,
            user_id=current.id,
            url=payload.url,
            payload=result,
        )
    )
    return WebPhishingDetectResponse.model_validate(result)


@router.post("/web/phishing/predict-upload", response_model=WebPhishingDetectResponse)
@router.post("/web/phishing/upload", response_model=WebPhishingDetectResponse, include_in_schema=False)
async def detect_web_phishing_upload(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    url: str = Form(...),
    html_file: UploadFile | None = File(default=None),
    return_features: bool = Form(False),
) -> WebPhishingDetectResponse:
    _ = current
    html = await _read_html_upload(html_file, max_bytes=settings.max_upload_bytes)
    result = detection_service.detect_web_phishing(
        url=url,
        html=html,
        return_features=return_features,
    )
    result.update(
        detection_service.persist_web_phishing_result(
            db,
            user_id=current.id,
            url=url,
            payload=result,
        )
    )
    return WebPhishingDetectResponse.model_validate(result)


@router.post("/ocr-phishing/check", response_model=DirectImageSkillCheckResponse)
async def check_ocr_phishing(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    image_file: UploadFile = File(...),
) -> DirectImageSkillCheckResponse:
    return await _run_direct_image_skill(
        db=db,
        current=current,
        image_file=image_file,
        kind="ocr",
        result_key="ocr_result",
        runner=run_ocr_phishing,
    )


@router.post("/official-document/check", response_model=DirectImageSkillCheckResponse)
async def check_official_document(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    image_file: UploadFile = File(...),
) -> DirectImageSkillCheckResponse:
    return await _run_direct_image_skill(
        db=db,
        current=current,
        image_file=image_file,
        kind="official-document",
        result_key="official_document_result",
        runner=run_official_document_checker,
        with_ocr=True,
    )


@router.post("/pii/check", response_model=DirectImageSkillCheckResponse)
async def check_pii(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    image_file: UploadFile = File(...),
) -> DirectImageSkillCheckResponse:
    return await _run_direct_image_skill(
        db=db,
        current=current,
        image_file=image_file,
        kind="pii",
        result_key="pii_result",
        runner=run_pii_guard,
        with_ocr=True,
    )


@router.post("/qr/check", response_model=DirectImageSkillCheckResponse)
async def check_qr(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    image_file: UploadFile = File(...),
) -> DirectImageSkillCheckResponse:
    return await _run_direct_image_skill(
        db=db,
        current=current,
        image_file=image_file,
        kind="qr",
        result_key="qr_result",
        runner=run_qr_inspector,
    )


@router.post("/impersonation/check", response_model=DirectImageSkillCheckResponse)
async def check_impersonation(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    image_file: UploadFile = File(...),
) -> DirectImageSkillCheckResponse:
    return await _run_direct_image_skill(
        db=db,
        current=current,
        image_file=image_file,
        kind="impersonation",
        result_key="impersonation_result",
        runner=run_impersonation_checker,
    )
