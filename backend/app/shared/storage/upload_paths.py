"""将上传文件写入 storage/uploads，返回相对 upload_root 的路径（POSIX）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

_KIND_DIR = {
    "text": "text",
    "audio": "audio",
    "image": "visual",
    "video": "video",
}


def resolved_upload_root(upload_root: str) -> Path:
    p = Path(upload_root)
    if p.is_absolute():
        return p
    return (Path.cwd() / p).resolve()


def allocate_batch_folder_name(*, upload_root: Path, user_id: uuid.UUID) -> str:
    """
    每次提交独占一层目录名：UTC 精确到秒 %Y%m%d%H%M%S；同秒冲突时追加 _1、_2…
    完整相对路径形如：{user_id}/{batch}/audio/xxx.ext
    """
    user_dir = upload_root.resolve() / str(user_id)
    base = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    candidate = base
    n = 0
    while (user_dir / candidate).exists():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def save_upload_bytes(
    *,
    upload_root: Path,
    user_id: uuid.UUID,
    batch_folder: str,
    kind: str,
    data: bytes,
    suffix: str,
) -> str:
    """写入文件，返回相对 upload_root 的路径。"""
    if kind not in _KIND_DIR:
        raise ValueError(f"unknown upload kind: {kind}")
    sub = _KIND_DIR[kind]
    directory = upload_root / str(user_id) / batch_folder / sub
    directory.mkdir(parents=True, exist_ok=True)
    ext = suffix if suffix.startswith(".") else f".{suffix}" if suffix else ".bin"
    name = f"{uuid.uuid4()}{ext}"
    path = directory / name
    path.write_bytes(data)
    return path.relative_to(upload_root.resolve()).as_posix()


def save_avatar_bytes(
    *,
    upload_root: Path,
    user_id: uuid.UUID,
    data: bytes,
    suffix: str,
) -> str:
    """写入头像文件，返回可直接访问的 URL 路径。"""
    directory = upload_root / "avatars" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    ext = suffix if suffix.startswith(".") else f".{suffix}" if suffix else ".png"
    name = f"{uuid.uuid4()}{ext}"
    path = directory / name
    path.write_bytes(data)
    relative = path.relative_to(upload_root.resolve()).as_posix()
    return f"/uploads/{relative}"


def save_relation_avatar_bytes(
    *,
    upload_root: Path,
    user_id: uuid.UUID,
    relation_id: uuid.UUID,
    data: bytes,
    suffix: str,
) -> str:
    """写入关系对象头像文件，返回可直接访问的 URL 路径。"""
    directory = upload_root / "relations" / str(user_id) / str(relation_id)
    directory.mkdir(parents=True, exist_ok=True)
    ext = suffix if suffix.startswith(".") else f".{suffix}" if suffix else ".png"
    name = f"avatar-{uuid.uuid4()}{ext}"
    path = directory / name
    path.write_bytes(data)
    relative = path.relative_to(upload_root.resolve()).as_posix()
    return f"/uploads/{relative}"


def safe_suffix(filename: str | None, fallback: str) -> str:
    if not filename:
        return fallback
    suf = Path(filename).suffix.lower()
    if suf and len(suf) <= 10:
        return suf
    return fallback
