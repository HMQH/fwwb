"""AI 换脸识别服务。"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
import uuid
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection import repository as detection_repository
from app.domain.detection import service as detection_service
from app.domain.detection.entity import DetectionResult, DetectionSubmission
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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _score_to_percent(value: float | None) -> int:
    if value is None:
        return 0
    return max(0, min(100, round(float(value) * 100)))


def _build_ai_face_reasoning_graph(
    *,
    num_faces: int,
    fake_probability: float,
    risk_level: str,
) -> dict[str, Any]:
    verdict = "疑似 AI 换脸" if risk_level != "low" else "风险较低"
    return {
        "nodes": [
            {
                "id": "image_input",
                "label": "图片输入",
                "kind": "input",
                "tone": "primary",
                "lane": 0,
                "order": 0,
                "strength": 0.72,
                "meta": {"num_faces": num_faces},
            },
            {
                "id": "face_extract",
                "label": "人脸提取",
                "kind": "signal",
                "tone": "info",
                "lane": 1,
                "order": 0,
                "strength": max(0.28, fake_probability),
                "meta": {"detected_faces": num_faces},
            },
            {
                "id": "face_verdict",
                "label": verdict,
                "kind": "decision",
                "tone": "danger" if risk_level != "low" else "success",
                "lane": 2,
                "order": 0,
                "strength": max(0.3, fake_probability),
                "meta": {"risk_level": risk_level},
            },
        ],
        "edges": [
            {
                "id": "edge:image_input:face_extract",
                "source": "image_input",
                "target": "face_extract",
                "tone": "info",
                "kind": "reasoning",
                "weight": 0.62,
            },
            {
                "id": "edge:face_extract:face_verdict",
                "source": "face_extract",
                "target": "face_verdict",
                "tone": "danger" if risk_level != "low" else "success",
                "kind": "decision",
                "weight": max(0.42, fake_probability),
            },
        ],
        "highlighted_path": ["image_input", "face_extract", "face_verdict"],
        "highlighted_labels": ["图片输入", "人脸提取", verdict],
        "summary_metrics": {
            "num_faces": num_faces,
            "fake_probability": _score_to_percent(fake_probability),
        },
    }


def _build_ai_face_detection_result(
    *,
    submission: DetectionSubmission,
    job_id: uuid.UUID,
    detection_payload: dict[str, Any],
) -> DetectionResult:
    num_faces = int(detection_payload.get("num_faces") or 0)
    fake_probability = float(detection_payload.get("fake_probability") or 0)
    is_ai_face = bool(detection_payload.get("is_ai_face"))

    if num_faces <= 0:
        risk_level = "low"
        summary = "未检测到可识别的人脸"
        final_reason = "当前图片未检测到可用于 AI 换脸判断的人脸区域。"
        advice = ["补充更清晰的人脸图片", "换正面图重试", "结合原始素材核验"]
        need_manual_review = True
        fraud_type = "未检测到人脸"
    elif is_ai_face and fake_probability >= 0.8:
        risk_level = "high"
        summary = "疑似 AI 换脸"
        final_reason = f"图片检测到 {num_faces} 张人脸，最高换脸概率 {_score_to_percent(fake_probability)}。"
        advice = ["暂停传播该图片", "改用原始视频核验", "保留图片证据"]
        need_manual_review = False
        fraud_type = "AI换脸"
    elif is_ai_face:
        risk_level = "medium"
        summary = "存在 AI 换脸风险"
        final_reason = f"图片检测到 {num_faces} 张人脸，存在较高换脸特征，最高概率 {_score_to_percent(fake_probability)}。"
        advice = ["继续人工复核", "对比原始头像", "不要仅凭截图做决定"]
        need_manual_review = True
        fraud_type = "疑似AI换脸"
    else:
        risk_level = "low"
        summary = "未发现明显 AI 换脸"
        final_reason = f"图片检测到 {num_faces} 张人脸，当前未发现明显 AI 换脸特征。"
        advice = ["仍需结合上下文判断", "核验图片来源", "保留原图"]
        need_manual_review = False
        fraud_type = "真人图像"

    risk_evidence = []
    if num_faces > 0 and risk_level != "low":
        risk_evidence.append(f"最高换脸概率 {_score_to_percent(fake_probability)}")
    counter_evidence = []
    if num_faces > 0 and risk_level == "low":
        counter_evidence.append(f"真人概率 {_score_to_percent(float(detection_payload.get('real_probability') or 0))}")

    reasoning_graph = _build_ai_face_reasoning_graph(
        num_faces=num_faces,
        fake_probability=fake_probability,
        risk_level=risk_level,
    )
    detail = {
        "message": "已完成 AI 换脸识别。",
        "used_modules": ["preprocess", "embedding", "graph_reasoning", "finalize"],
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "人脸提取", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "llm_reasoning", "label": "模型判别", "status": "pending", "enabled": False},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "reasoning_graph": reasoning_graph,
        "reasoning_path": reasoning_graph["highlighted_labels"],
        "final_score": _score_to_percent(fake_probability),
        "risk_evidence": risk_evidence,
        "counter_evidence": counter_evidence,
        "faces": list(detection_payload.get("faces") or []),
        "image_size": detection_payload.get("image_size"),
        "num_faces": num_faces,
        "fake_probability": fake_probability,
        "real_probability": float(detection_payload.get("real_probability") or 0),
    }

    return DetectionResult(
        submission_id=submission.id,
        job_id=job_id,
        risk_level=risk_level,
        fraud_type=fraud_type,
        confidence=float(detection_payload.get("confidence") or 0),
        is_fraud=is_ai_face,
        summary=summary,
        final_reason=final_reason,
        need_manual_review=need_manual_review,
        stage_tags=["AI换脸检测", "图像鉴伪"],
        hit_rules=["AI换脸命中"] if is_ai_face else [],
        rule_hits=[
            {
                "name": "AI换脸识别",
                "category": "ai_face",
                "risk_points": _score_to_percent(fake_probability),
                "explanation": "已执行图片 AI 换脸检测。",
                "matched_texts": [str(num_faces)],
                "stage_tag": "AI换脸检测",
                "fraud_type_hint": "AI换脸" if is_ai_face else None,
            }
        ],
        extracted_entities={
            "num_faces": num_faces,
            "fake_probability": fake_probability,
            "prediction": detection_payload.get("prediction"),
        },
        input_highlights=[
            {
                "text": f"{num_faces} 张人脸",
                "reason": f"最高换脸概率 {_score_to_percent(fake_probability)}",
            }
        ],
        retrieved_evidence=[],
        counter_evidence=[],
        advice=advice,
        llm_model=str(detection_payload.get("model") or ""),
        result_detail=detail,
    )


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

    submission = detection_repository.save_submission(
        db,
        DetectionSubmission(
            user_id=user_id,
            relation_profile_id=None,
            storage_batch_id=batch_folder,
            has_text=False,
            has_audio=False,
            has_image=True,
            has_video=False,
            text_paths=[],
            audio_paths=[],
            image_paths=[saved_file_path],
            video_paths=[],
            text_content=None,
        ),
    )

    upload_rows = upload_service.sync_submission_uploads(
        db,
        submission_id=submission.id,
        user_id=user_id,
        storage_batch_id=batch_folder,
        text_paths=[],
        audio_paths=[],
        image_paths=[saved_file_path],
        video_paths=[],
    )
    upload_row = next((row for row in upload_rows if row.upload_type == "image"), None)

    job = detection_repository.create_job(
        db,
        submission_id=submission.id,
        job_type="ai_face",
        input_modality="image",
        llm_model=str(result.get("model") or ""),
    )
    now = _utcnow()
    job.status = "completed"
    job.current_step = "finalize"
    job.progress_percent = 100
    job.started_at = now
    job.finished_at = now
    job.progress_detail = {
        "status": "completed",
        "current_step": "finalize",
        "progress_percent": 100,
        "module_trace": [
            {"key": "preprocess", "label": "预处理", "status": "completed"},
            {"key": "embedding", "label": "人脸提取", "status": "completed"},
            {"key": "graph_reasoning", "label": "风险判断", "status": "completed"},
            {"key": "finalize", "label": "完成", "status": "completed"},
        ],
        "used_modules": ["preprocess", "embedding", "graph_reasoning", "finalize"],
        "final_score": _score_to_percent(float(result.get("fake_probability") or 0)),
    }
    job.rule_score = _score_to_percent(float(result.get("fake_probability") or 0))
    job.retrieval_query = safe_name
    detection_repository.save_job(db, job)

    result_row = _build_ai_face_detection_result(
        submission=submission,
        job_id=job.id,
        detection_payload=result,
    )
    detection_service.persist_result_with_side_effects(
        db,
        submission=submission,
        result_row=result_row,
    )

    result.update(
        {
            "storage_batch_id": batch_folder,
            "stored_file_path": saved_file_path,
            "upload_id": upload_row.id if upload_row is not None else None,
            "submission_id": submission.id,
            "job_id": job.id,
            "result_id": result_row.id,
        }
    )
    return result
