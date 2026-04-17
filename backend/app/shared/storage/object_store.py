"""本地文件对象存储适配。"""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from app.shared.storage.upload_paths import allocate_batch_folder_name, resolved_upload_root


def save_call_recording_file(
    *,
    upload_root_cfg: str,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    source_file: Path,
) -> tuple[str, str]:
    upload_root = resolved_upload_root(upload_root_cfg)
    batch_folder = allocate_batch_folder_name(upload_root=upload_root, user_id=user_id)
    target_dir = upload_root / str(user_id) / batch_folder / "audio"
    target_dir.mkdir(parents=True, exist_ok=True)

    suffix = source_file.suffix or ".wav"
    target_file = target_dir / f"{session_id}{suffix}"
    shutil.move(str(source_file), target_file)

    relative = target_file.relative_to(upload_root).as_posix()
    return f"/uploads/{relative}", relative
