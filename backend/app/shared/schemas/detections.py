"""检测提交 API模型。"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    storage_batch_id: str
    has_text: bool
    has_audio: bool
    has_image: bool
    has_video: bool
    text_paths: list[str] = Field(default_factory=list)
    audio_paths: list[str] = Field(default_factory=list)
    image_paths: list[str] = Field(default_factory=list)
    video_paths: list[str] = Field(default_factory=list)
    text_content: str | None
    created_at: datetime
    updated_at: datetime
