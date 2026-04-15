"""AI 换脸识别服务。"""
from __future__ import annotations

from pathlib import Path
from threading import Lock
import uuid
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.uploads import service as upload_service
from app.shared.core.config import settings
from app.shared.storage.file_validation import validate_filename_for_kind
from app.shared.storage.upload_paths import (
    allocate_batch_folder_name,
    resolved_upload_root,
    safe_suffix,
    save_upload_bytes,
)

if TYPE_CHECKING:
    from app.domain.ai_face.detector import SBIMultiFaceDetector

_DETECTOR: SBIMultiFaceDetector | None = None
_DETECTOR_KEY: tuple[str, str, str, float, float, float, int] | None = None
_DETECTOR_LOCK = Lock()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resolve_path(raw_path: str | None) -> Path:
    candidate = Path((raw_path or "").strip()).expanduser()
    if not candidate.is_absolute():
        candidate = _repo_root() / candidate
    return candidate.resolve()


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(_repo_root()).as_posix()
    except ValueError:
        return str(path)


def _detector_cls() -> type[SBIMultiFaceDetector]:
    from app.domain.ai_face.detector import SBIMultiFaceDetector as _SBIMultiFaceDetector

    return _SBIMultiFaceDetector


def _create_detector() -> tuple[SBIMultiFaceDetector, Path, Path]:
    sbi_weight_path = _resolve_path(settings.ai_face_local_model_path)
    retinaface_weight_path = _resolve_path(settings.ai_face_retinaface_model_path)

    if not sbi_weight_path.is_file():
        raise RuntimeError(f"未找到 SBI 权重文件: {_display_path(sbi_weight_path)}")
    if not retinaface_weight_path.is_file():
        raise RuntimeError(f"未找到 RetinaFace 权重文件: {_display_path(retinaface_weight_path)}")

    detector = _detector_cls()(
        sbi_weight_path=sbi_weight_path,
        retinaface_weight_path=retinaface_weight_path,
        device=settings.ai_face_device,
        fake_threshold=settings.ai_face_fake_threshold,
        face_confidence_threshold=settings.ai_face_face_confidence_threshold,
        face_nms_threshold=settings.ai_face_face_nms_threshold,
        retinaface_max_size=settings.ai_face_retinaface_max_size,
        backend_name=settings.ai_face_detector_backend,
        model_name=_display_path(sbi_weight_path),
        face_detector_name=_display_path(retinaface_weight_path),
    )
    return detector, sbi_weight_path, retinaface_weight_path


def get_ai_face_detector() -> SBIMultiFaceDetector:
    global _DETECTOR, _DETECTOR_KEY

    detector_key = (
        str(_resolve_path(settings.ai_face_local_model_path)),
        str(_resolve_path(settings.ai_face_retinaface_model_path)),
        settings.ai_face_device,
        float(settings.ai_face_fake_threshold),
        float(settings.ai_face_face_confidence_threshold),
        float(settings.ai_face_face_nms_threshold),
        int(settings.ai_face_retinaface_max_size),
    )

    with _DETECTOR_LOCK:
        if _DETECTOR is not None and _DETECTOR_KEY == detector_key:
            return _DETECTOR

        detector, _, _ = _create_detector()
        _DETECTOR = detector
        _DETECTOR_KEY = detector_key
        return detector


def detect_ai_face(
    *,
    image_bytes: bytes,
    filename: str | None,
    content_type: str | None,
) -> dict[str, Any]:
    """执行 AI 换脸识别并返回前端可直接使用的数据。"""
    _ = content_type
    detector = get_ai_face_detector()
    return detector.predict_image_bytes(image_bytes, filename=filename)


def detect_ai_face_and_store(
    db: Session,
    *,
    user_id: uuid.UUID,
    image_bytes: bytes,
    filename: str | None,
    content_type: str | None,
) -> dict[str, Any]:
    safe_name = (filename or "ai-face.jpg").strip() or "ai-face.jpg"
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片内容不能为空")
    if len(image_bytes) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件过大，超过 {settings.max_upload_bytes} 字节限制",
        )

    validate_filename_for_kind(safe_name, "image")

    result = detect_ai_face(
        image_bytes=image_bytes,
        filename=safe_name,
        content_type=content_type,
    )

    upload_root = resolved_upload_root(settings.upload_root)
    upload_root.mkdir(parents=True, exist_ok=True)
    batch_folder = allocate_batch_folder_name(upload_root=upload_root, user_id=user_id)
    saved_file_path = save_upload_bytes(
        upload_root=upload_root,
        user_id=user_id,
        batch_folder=batch_folder,
        kind="image",
        data=image_bytes,
        suffix=safe_suffix(safe_name, ".jpg"),
    )

    upload_rows = upload_service.sync_upload_bundle(
        db,
        user_id=user_id,
        storage_batch_id=batch_folder,
        text_paths=[],
        audio_paths=[],
        image_paths=[saved_file_path],
        video_paths=[],
        source_submission_id=None,
    )
    upload_row = next((row for row in upload_rows if row.upload_type == "image"), None)

    result.update(
        {
            "storage_batch_id": batch_folder,
            "stored_file_path": saved_file_path,
            "upload_id": upload_row.id if upload_row is not None else None,
        }
    )
    return result
