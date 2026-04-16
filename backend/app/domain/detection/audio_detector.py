from __future__ import annotations

import os
import pickle
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from app.domain.detection.audio_feature_extractor import (
    FEATURE_VERSION,
    TARGET_SR,
    extract_features_from_waveform,
    load_audio,
)
from app.shared.core.config import settings

MODEL_RUN_ID = "audio-verify-v1"

_JOB_LOCK = threading.Lock()
_JOBS: dict[uuid.UUID, dict[str, Any]] = {}
_BATCH_JOBS: dict[uuid.UUID, dict[str, Any]] = {}


class AudioDecodeError(RuntimeError):
    """上传的音频无法被解码。"""


class AudioDetectorNotReadyError(RuntimeError):
    """后端音频鉴伪模型或依赖尚未就绪。"""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _model_path() -> Path:
    return Path(settings.audio_verify_model_path).expanduser().resolve()


@lru_cache(maxsize=1)
def get_model_bundle() -> dict[str, Any]:
    model_path = _model_path()
    if not model_path.exists():
        raise AudioDetectorNotReadyError(f"未找到音频鉴伪模型文件：{model_path}")

    try:
        with model_path.open("rb") as file:
            payload = pickle.load(file)
    except Exception as exc:  # noqa: BLE001
        raise AudioDetectorNotReadyError(f"无法加载音频鉴伪模型：{exc}") from exc

    model = payload.get("model")
    if model is None:
        raise AudioDetectorNotReadyError("音频鉴伪模型文件缺少 model 字段。")
    return payload


def predict_file(audio_path: str) -> dict[str, Any]:
    try:
        waveform = load_audio(audio_path)
    except Exception as exc:  # noqa: BLE001
        raise AudioDecodeError(
            "无法解码该音频，请优先上传 wav/mp3/m4a 等常见格式，并确认文件未损坏。"
        ) from exc

    if waveform.size == 0:
        raise RuntimeError("音频文件为空或无法解析。")

    bundle = get_model_bundle()
    model = bundle["model"]
    class_names = [str(name) for name in bundle.get("class_names", ["genuine", "fake"])]

    features = extract_features_from_waveform(waveform).reshape(1, -1).astype(np.float32)
    prob = model.predict_proba(features)[0]
    pred_idx = int(np.argmax(prob))

    prob_by_class = {
        class_names[idx]: float(prob[idx])
        for idx in range(min(len(class_names), len(prob)))
    }
    genuine_prob = prob_by_class.get("genuine", float(prob[0]))
    fake_prob = prob_by_class.get("fake", float(prob[-1]))
    label = class_names[pred_idx] if pred_idx < len(class_names) else ("genuine" if genuine_prob >= fake_prob else "fake")

    return {
        "label": label,
        "genuine_prob": genuine_prob,
        "fake_prob": fake_prob,
        "score": genuine_prob - fake_prob,
        "duration_sec": round(len(waveform) / TARGET_SR, 3),
        "model_version": MODEL_RUN_ID,
        "feature_version": str(bundle.get("feature_version", FEATURE_VERSION)),
    }


def create_job(*, user_id: uuid.UUID, filename: str | None) -> dict[str, Any]:
    now = _now_utc()
    job_id = uuid.uuid4()
    record = {
        "job_id": job_id,
        "user_id": user_id,
        "filename": filename,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "error_message": None,
        "result": None,
    }
    with _JOB_LOCK:
        _JOBS[job_id] = record
    return dict(record)


def get_job(job_id: uuid.UUID) -> dict[str, Any] | None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        return None if record is None else dict(record)


def _copy_batch_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        **record,
        "items": [dict(item) for item in record.get("items", [])],
    }


def ensure_job_owner(job_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any] | None:
    record = get_job(job_id)
    if record is None or record["user_id"] != user_id:
        return None
    return record


def create_batch_job(*, user_id: uuid.UUID, filenames: list[str | None]) -> dict[str, Any]:
    now = _now_utc()
    batch_id = uuid.uuid4()
    items = [
        {
            "item_id": uuid.uuid4(),
            "filename": filename,
            "status": "pending",
            "error_message": None,
            "result": None,
        }
        for filename in filenames
    ]
    record = {
        "batch_id": batch_id,
        "user_id": user_id,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "total_count": len(items),
        "completed_count": 0,
        "failed_count": 0,
        "items": items,
    }
    with _JOB_LOCK:
        _BATCH_JOBS[batch_id] = record
    return _copy_batch_record(record)


def get_batch_job(batch_id: uuid.UUID) -> dict[str, Any] | None:
    with _JOB_LOCK:
        record = _BATCH_JOBS.get(batch_id)
        return None if record is None else _copy_batch_record(record)


def ensure_batch_job_owner(batch_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any] | None:
    record = get_batch_job(batch_id)
    if record is None or record["user_id"] != user_id:
        return None
    return record


def _update_job(job_id: uuid.UUID, **fields: Any) -> None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        record.update(fields)
        record["updated_at"] = _now_utc()


def _refresh_batch_counters(record: dict[str, Any]) -> None:
    completed_count = sum(1 for item in record["items"] if item["status"] == "completed")
    failed_count = sum(1 for item in record["items"] if item["status"] == "failed")
    pending_or_running = any(item["status"] in {"pending", "running"} for item in record["items"])

    record["completed_count"] = completed_count
    record["failed_count"] = failed_count

    if pending_or_running:
        record["status"] = "running"
    elif completed_count == 0 and failed_count > 0:
        record["status"] = "failed"
    else:
        record["status"] = "completed"


def _update_batch_job(batch_id: uuid.UUID, **fields: Any) -> None:
    with _JOB_LOCK:
        record = _BATCH_JOBS.get(batch_id)
        if record is None:
            return
        record.update(fields)
        record["updated_at"] = _now_utc()


def _update_batch_item(batch_id: uuid.UUID, item_id: uuid.UUID, **fields: Any) -> None:
    with _JOB_LOCK:
        record = _BATCH_JOBS.get(batch_id)
        if record is None:
            return
        for item in record["items"]:
            if item["item_id"] == item_id:
                item.update(fields)
                break
        _refresh_batch_counters(record)
        record["updated_at"] = _now_utc()


def process_job(job_id: uuid.UUID, audio_path: str) -> None:
    _update_job(job_id, status="running", error_message=None)
    try:
        result = predict_file(audio_path)
    except Exception as exc:  # noqa: BLE001
        _update_job(job_id, status="failed", error_message=str(exc), result=None)
    else:
        _update_job(job_id, status="completed", result=result, error_message=None)
    finally:
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except OSError:
            pass


def process_batch_job(batch_id: uuid.UUID, audio_items: list[tuple[uuid.UUID, str]]) -> None:
    _update_batch_job(batch_id, status="running")
    for item_id, audio_path in audio_items:
        _update_batch_item(batch_id, item_id, status="running", error_message=None, result=None)
        try:
            result = predict_file(audio_path)
        except Exception as exc:  # noqa: BLE001
            _update_batch_item(batch_id, item_id, status="failed", error_message=str(exc), result=None)
        else:
            _update_batch_item(batch_id, item_id, status="completed", result=result, error_message=None)
        finally:
            try:
                if os.path.exists(audio_path):
                    os.remove(audio_path)
            except OSError:
                pass

    with _JOB_LOCK:
        record = _BATCH_JOBS.get(batch_id)
        if record is not None:
            _refresh_batch_counters(record)
            record["updated_at"] = _now_utc()


def write_upload_to_temp(data: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        return tmp.name
