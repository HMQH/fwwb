from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from app.shared.core.config import settings

MODEL_LABEL = "D3-XCLIP-16"
logger = logging.getLogger(__name__)


def _risk_rank(level: str | None) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(str(level or "").lower(), 0)


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if not text:
        raise RuntimeError("D3 detector returned empty stdout")

    brace_positions = [index for index, char in enumerate(text) if char == "{"] or [0]
    for start in reversed(brace_positions):
        candidate = text[start:].strip()
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise RuntimeError(f"Unable to parse D3 JSON output: {text[:800]}")


def _code_root() -> Path:
    return Path(settings.video_ai_code_root).expanduser().resolve()


def _runtime_root() -> Path:
    return Path(settings.video_ai_runtime_root).expanduser().resolve()


def _outputs_root() -> Path:
    return _runtime_root() / "outputs"


def _script_path() -> Path:
    return _code_root() / "predict_one_video.py"


def _subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    runtime_root = _runtime_root()
    hf_root = runtime_root / "hf"
    torch_root = runtime_root / "torch"
    env["HF_HOME"] = str(hf_root)
    env["TRANSFORMERS_CACHE"] = str(hf_root)
    env["TORCH_HOME"] = str(torch_root)
    return env


def _output_url_from_path(raw_path: str | None) -> str | None:
    value = str(raw_path or "").strip()
    if not value:
        return None
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = (_outputs_root() / candidate).resolve()
    else:
        candidate = candidate.resolve()

    try:
        relative = candidate.relative_to(_outputs_root().resolve()).as_posix()
    except ValueError:
        return None
    return f"/video-ai-outputs/{relative}"


def _normalize_explanation(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    def normalize_paths(raw_paths: Any) -> dict[str, str]:
        normalized_paths: dict[str, str] = {}
        if isinstance(raw_paths, dict):
            for key, value in raw_paths.items():
                url = _output_url_from_path(str(value) if value is not None else None)
                if url:
                    normalized_paths[str(key)] = url
        return normalized_paths

    top_anomalies: list[dict[str, Any]] = []
    raw_anomalies = payload.get("top_anomalies")
    if isinstance(raw_anomalies, list):
        for item in raw_anomalies:
            if not isinstance(item, dict):
                continue
            top_anomalies.append(
                {
                    "rank": item.get("rank"),
                    "key_second_order_index": item.get("key_second_order_index"),
                    "key_frame_index": item.get("key_frame_index"),
                    "key_time_sec": item.get("key_time_sec"),
                    "peak_second_order_score": item.get("peak_second_order_score"),
                    "second_order_flow_peak_magnitude": item.get("second_order_flow_peak_magnitude"),
                    "second_order_flow_mean_magnitude": item.get("second_order_flow_mean_magnitude"),
                    "frame_indices": item.get("frame_indices"),
                    "paths": normalize_paths(item.get("paths")),
                    "summary": item.get("summary"),
                }
            )

    return {
        "key_second_order_index": payload.get("key_second_order_index"),
        "key_frame_index": payload.get("key_frame_index"),
        "key_time_sec": payload.get("key_time_sec"),
        "peak_second_order_score": payload.get("peak_second_order_score"),
        "second_order_flow_peak_magnitude": payload.get("second_order_flow_peak_magnitude"),
        "second_order_flow_mean_magnitude": payload.get("second_order_flow_mean_magnitude"),
        "frame_indices": payload.get("frame_indices"),
        "paths": normalize_paths(payload.get("paths")),
        "summary": payload.get("summary"),
        "error": payload.get("error"),
        "top_anomalies": top_anomalies,
    }


def _classify_std(std_value: float) -> tuple[str, bool, str, float, str, str]:
    low_threshold = float(settings.video_ai_std_low_threshold)
    normal_upper = float(settings.video_ai_std_normal_upper)
    high_threshold = float(settings.video_ai_std_high_threshold)

    if std_value < low_threshold:
        return (
            "high",
            True,
            "oversmooth_ai",
            0.88,
            "视频时序变化过于平滑，疑似高质量 AI 生成视频。",
            f"STD={std_value:.3f} 低于 {low_threshold:.2f}，画面随时间的二阶波动异常偏小，更像生成模型输出的平滑时序。",
        )
    if std_value <= normal_upper:
        confidence = max(0.55, 0.82 - abs(std_value - ((low_threshold + normal_upper) / 2)) * 0.08)
        return (
            "low",
            False,
            "physical_normal",
            round(confidence, 3),
            "视频时序波动落在经验真实区间，暂未见明显 AI 生成痕迹。",
            f"STD={std_value:.3f} 处于 {low_threshold:.2f}~{normal_upper:.2f} 的经验真实区间，时序波动更接近真实物理运动。",
        )
    if std_value <= high_threshold:
        confidence = min(0.86, 0.6 + (std_value - normal_upper) / max(high_threshold - normal_upper, 1e-6) * 0.18)
        return (
            "medium",
            True,
            "unstable_review",
            round(confidence, 3),
            "视频时序波动偏高，超出正常物理区间，存在 AI 生成或后期处理异常的可能。",
            f"STD={std_value:.3f} 高于正常区间上界 {normal_upper:.2f}，但尚未达到强异常阈值 {high_threshold:.2f}，建议结合内容继续复核。",
        )
    confidence = min(0.98, 0.86 + min(std_value - high_threshold, 3.0) * 0.03)
    return (
        "high",
        True,
        "temporal_collapse_ai",
        round(confidence, 3),
        "视频时序波动极高，出现明显时序崩坏/闪烁特征，疑似劣质 AI 生成视频。",
        f"STD={std_value:.3f} 高于强异常阈值 {high_threshold:.2f}，出现不符合自然物理运动的剧烈时序抖动/闪烁。",
    )


def analyze_video_file(video_path: Path, *, source_path: str | None = None) -> dict[str, Any]:
    if not settings.video_ai_detector_enabled:
        raise RuntimeError("Video AI detector is disabled by configuration.")

    script_path = _script_path()
    if not script_path.is_file():
        raise RuntimeError(f"D3 script not found: {script_path}")

    runtime_root = _runtime_root()
    runtime_root.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        str(script_path),
        "--video",
        str(video_path),
        "--runtime-root",
        str(runtime_root),
        "--encoder",
        settings.video_ai_encoder,
        "--loss",
        settings.video_ai_loss,
        "--device",
        settings.video_ai_device,
    ]
    if settings.video_ai_keep_frames:
        command.append("--keep-frames")
    if settings.video_ai_generate_explanation:
        command.append("--generate-explanation")

    started_at = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=str(_code_root()),
        env=_subprocess_env(),
        capture_output=True,
        text=True,
        timeout=max(30, int(settings.video_ai_timeout_seconds)),
        check=False,
    )
    elapsed = time.perf_counter() - started_at
    if completed.returncode != 0:
        error_detail = (completed.stderr or completed.stdout or "").strip()
        logger.error(
            "D3 inference failed: file=%s elapsed=%.2fs exit=%s explanation=%s device=%s stderr=%s",
            source_path or str(video_path),
            elapsed,
            completed.returncode,
            settings.video_ai_generate_explanation,
            settings.video_ai_device,
            error_detail[:500],
        )
        raise RuntimeError(f"D3 inference failed (exit={completed.returncode}): {error_detail[:2000]}")

    payload = _extract_json_object(completed.stdout)
    logger.info(
        "D3 inference finished: file=%s elapsed=%.2fs device=%s frame_count=%s explanation=%s output_path=%s",
        source_path or str(video_path),
        elapsed,
        payload.get("device") or settings.video_ai_device,
        payload.get("frame_count"),
        settings.video_ai_generate_explanation,
        payload.get("output_path"),
    )
    std_value = float(payload.get("second_order_std") or 0.0)
    mean_value = float(payload.get("second_order_mean") or 0.0)
    risk_level, suspect, pattern, confidence, summary, final_reason = _classify_std(std_value)
    explanation = _normalize_explanation(payload.get("explanation") if isinstance(payload, dict) else None)

    return {
        "file_path": source_path or str(video_path),
        "file_name": video_path.name,
        "status": "completed",
        "error_message": None,
        "encoder": str(payload.get("encoder") or settings.video_ai_encoder),
        "loss_type": str(payload.get("loss_type") or settings.video_ai_loss),
        "device": str(payload.get("device") or settings.video_ai_device),
        "frame_count": int(payload.get("frame_count") or 0),
        "second_order_mean": mean_value,
        "second_order_std": std_value,
        "second_order_series": payload.get("second_order_series"),
        "risk_level": risk_level,
        "is_ai_generated_suspect": suspect,
        "confidence": confidence,
        "pattern": pattern,
        "summary": summary,
        "final_reason": final_reason,
        "model_name": MODEL_LABEL,
        "thresholds": {
            "low_std_threshold": float(settings.video_ai_std_low_threshold),
            "normal_std_upper": float(settings.video_ai_std_normal_upper),
            "high_std_threshold": float(settings.video_ai_std_high_threshold),
        },
        "key_time_sec": explanation.get("key_time_sec") if explanation else None,
        "explanation": explanation,
        "output_path": _output_url_from_path(payload.get("output_path")),
        "raw": payload,
    }


def analyze_video_batch(video_paths: list[tuple[str, Path]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for source_path, absolute_path in video_paths:
        try:
            items.append(analyze_video_file(absolute_path, source_path=source_path))
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {
                    "file_path": source_path,
                    "file_name": absolute_path.name,
                    "status": "failed",
                    "error_message": str(exc),
                }
            )

    suspicious_count = sum(1 for item in items if bool(item.get("is_ai_generated_suspect")))
    high_count = sum(1 for item in items if item.get("risk_level") == "high")
    medium_count = sum(1 for item in items if item.get("risk_level") == "medium")
    low_count = sum(1 for item in items if item.get("risk_level") == "low")
    overall = "low"
    for candidate in items:
        if _risk_rank(candidate.get("risk_level")) > _risk_rank(overall):
            overall = str(candidate.get("risk_level") or overall)

    scored = [item for item in items if isinstance(item.get("second_order_std"), (int, float))]
    scored.sort(
        key=lambda item: (_risk_rank(str(item.get("risk_level"))), -float(item.get("confidence") or 0.0)),
        reverse=True,
    )
    lead_item = scored[0] if scored else None

    if lead_item and overall == "high":
        overall_summary = str(lead_item.get("summary") or "")
    elif lead_item and overall == "medium":
        overall_summary = "收到的视频存在异常时序波动，建议结合话术内容和来源继续复核。"
    elif lead_item:
        overall_summary = "收到的视频时序波动整体落在经验真实区间，暂未见明显 AI 生成痕迹。"
    else:
        overall_summary = "未能完成视频时序检测。"

    return {
        "items": items,
        "failed_items": failures,
        "summary": {
            "model_name": MODEL_LABEL,
            "total_count": len(video_paths),
            "analyzed_count": len(items),
            "failed_count": len(failures),
            "suspicious_count": suspicious_count,
            "high_count": high_count,
            "medium_count": medium_count,
            "low_count": low_count,
            "overall_risk_level": overall,
            "overall_summary": overall_summary,
            "lead_item": lead_item,
            "low_std_threshold": float(settings.video_ai_std_low_threshold),
            "normal_std_upper": float(settings.video_ai_std_normal_upper),
            "high_std_threshold": float(settings.video_ai_std_high_threshold),
        },
    }
