from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class AudioVerifyResponse(BaseModel):
    label: str
    genuine_prob: float
    fake_prob: float
    score: float
    duration_sec: float
    model_version: str
    feature_version: str


class AudioVerifyJobSubmitResponse(BaseModel):
    job_id: uuid.UUID
    status: str
    created_at: datetime
    filename: str | None = None


class AudioVerifyJobResponse(AudioVerifyJobSubmitResponse):
    updated_at: datetime
    error_message: str | None = None
    result: AudioVerifyResponse | None = None


class AudioVerifyBatchItemResponse(BaseModel):
    item_id: uuid.UUID
    filename: str | None = None
    status: str
    error_message: str | None = None
    result: AudioVerifyResponse | None = None


class AudioVerifyBatchJobSubmitResponse(BaseModel):
    batch_id: uuid.UUID
    status: str
    created_at: datetime
    total_count: int
    items: list[AudioVerifyBatchItemResponse]


class AudioVerifyBatchJobResponse(AudioVerifyBatchJobSubmitResponse):
    updated_at: datetime
    completed_count: int
    failed_count: int
