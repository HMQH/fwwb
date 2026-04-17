"""AI 换脸识别接口 schema。"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class AIFaceImageSize(BaseModel):
    width: int
    height: int


class AIFaceFaceResult(BaseModel):
    face_id: int
    bbox: list[int]
    det_score: float
    fake_score: float
    label: str
    landmarks: list[list[float]] = Field(default_factory=list)


class AIFaceCheckResponse(BaseModel):
    status: str = "ok"
    message: str = "ok"
    source: str = ""
    prediction: str
    is_ai_face: bool
    confidence: float
    fake_probability: float
    real_probability: float = 0.0
    image_fake_score: float | None = None
    raw_label: str = ""
    model: str = ""
    face_detector_model: str = ""
    backend: str = "local_sbi_multiface"
    device: str = "cpu"
    threshold: float | None = None
    num_faces: int = 0
    image_size: AIFaceImageSize
    faces: list[AIFaceFaceResult] = Field(default_factory=list)
    storage_batch_id: str | None = None
    stored_file_path: str | None = None
    upload_id: uuid.UUID | None = None
    submission_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    result_id: uuid.UUID | None = None
