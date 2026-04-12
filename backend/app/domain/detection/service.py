"""创建一次多模态检测提交（落库 + 本地文件）。"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection.entity import DetectionSubmission
from app.domain.detection.kinds import UploadKind
from app.domain.detection import repository as detection_repository
from app.shared.storage.file_validation import validate_bundle_filenames
from app.shared.storage.upload_paths import (
    allocate_batch_folder_name,
    resolved_upload_root,
    safe_suffix,
    save_upload_bytes,
)


def _strip(s: str | None) -> str:
    return (s or "").strip()


def create_submission(
    db: Session,
    *,
    user_id: uuid.UUID,
    upload_root_cfg: str,
    max_upload_bytes: int,
    text_content: str | None,
    file_bundles: dict[UploadKind, list[tuple[bytes, str]]],
) -> DetectionSubmission:
    """
    file_bundles: 每种模态可多文件 (bytes, original_filename)。
    """
    upload_root = resolved_upload_root(upload_root_cfg)

    for _kind, items in file_bundles.items():
        for data, _fn in items:
            if len(data) > max_upload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"文件过大（>{max_upload_bytes} 字节）",
                )

    validate_bundle_filenames(file_bundles)

    batch_folder = allocate_batch_folder_name(upload_root=upload_root, user_id=user_id)

    text_paths: list[str] = []
    audio_paths: list[str] = []
    image_paths: list[str] = []
    video_paths: list[str] = []

    for data, fn in file_bundles.get("text", []):
        if data:
            suf = safe_suffix(fn, ".txt")
            text_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="text",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("audio", []):
        if data:
            suf = safe_suffix(fn, ".m4a")
            audio_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="audio",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("image", []):
        if data:
            suf = safe_suffix(fn, ".jpg")
            image_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="image",
                    data=data,
                    suffix=suf,
                )
            )
    for data, fn in file_bundles.get("video", []):
        if data:
            suf = safe_suffix(fn, ".mp4")
            video_paths.append(
                save_upload_bytes(
                    upload_root=upload_root,
                    user_id=user_id,
                    batch_folder=batch_folder,
                    kind="video",
                    data=data,
                    suffix=suf,
                )
            )

    tc = _strip(text_content)

    has_text = bool(tc) or bool(text_paths)
    has_audio = bool(audio_paths)
    has_image = bool(image_paths)
    has_video = bool(video_paths)

    if not (has_text or has_audio or has_image or has_video):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少提供一种输入：文字内容或任意附录文件",
        )

    row = DetectionSubmission(
        user_id=user_id,
        storage_batch_id=batch_folder,
        has_text=has_text,
        has_audio=has_audio,
        has_image=has_image,
        has_video=has_video,
        text_paths=text_paths,
        audio_paths=audio_paths,
        image_paths=image_paths,
        video_paths=video_paths,
        text_content=tc or None,
    )
    return detection_repository.save_submission(db, row)
