"""按附录槽位校验文件名扩展名（与前端约定一致）。"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status

from app.domain.detection.kinds import UploadKind

AUDIO_EXT = frozenset({
    ".mp3",
    ".m4a",
    ".aac",
    ".wav",
    ".ogg",
    ".flac",
    ".opus",
    ".amr",
})
VIDEO_EXT = frozenset({
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".m4v",
    ".avi",
    ".3gp",
    ".mpeg",
    ".mpg",
})
IMAGE_EXT = frozenset({
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".heic",
    ".bmp",
})
TEXT_EXT = frozenset({
    ".txt",
    ".pdf",
    ".md",
    ".json",
    ".csv",
    ".log",
    ".doc",
    ".docx",
})

_KIND_ALLOWED: dict[UploadKind, frozenset[str]] = {
    "text": TEXT_EXT,
    "audio": AUDIO_EXT,
    "image": IMAGE_EXT,
    "video": VIDEO_EXT,
}

_KIND_LABEL = {
    "text": "文本附录",
    "audio": "音频",
    "image": "图片",
    "video": "视频",
}


def _suffix_lower(filename: str) -> str:
    return Path(filename).suffix.lower()


def validate_filename_for_kind(filename: str, kind: UploadKind) -> None:
    suf = _suffix_lower(filename)
    if not suf:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{_KIND_LABEL[kind]}文件名需带扩展名（如 .mp3、.mp4）",
        )
    allowed = _KIND_ALLOWED[kind]
    if suf not in allowed:
        sample = ", ".join(sorted(allowed)[:8])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{_KIND_LABEL[kind]}仅支持以下类型（示例）：{sample}等",
        )


def validate_bundle_filenames(file_bundles: dict[UploadKind, list[tuple[bytes, str]]]) -> None:
    for kind, items in file_bundles.items():
        for _data, fn in items:
            validate_filename_for_kind(fn, kind)
