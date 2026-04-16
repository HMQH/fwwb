"""反诈助手 API schema。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AssistantSessionCreateRequest(BaseModel):
    relation_profile_id: uuid.UUID | None = None
    source_submission_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=24)


class AssistantSendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1200)
    relation_profile_id: uuid.UUID | None = None


class AssistantSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    relation_profile_id: uuid.UUID | None = None
    source_submission_id: uuid.UUID | None = None
    title: str
    created_at: datetime
    updated_at: datetime


class AssistantMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    content: str
    extra_payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AssistantSessionDetailResponse(BaseModel):
    session: AssistantSessionResponse
    messages: list[AssistantMessageResponse] = Field(default_factory=list)


class AssistantConversationTurnResponse(BaseModel):
    session: AssistantSessionResponse
    user_message: AssistantMessageResponse
    assistant_message: AssistantMessageResponse
