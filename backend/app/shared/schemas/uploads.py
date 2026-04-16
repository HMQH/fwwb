"""上传记录接口 schema。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MemoryScope = Literal["short_term", "long_term"]


class UploadRelationBindingResponse(BaseModel):
    relation_profile_id: uuid.UUID
    relation_name: str
    relation_type: str
    file_count: int


class UploadFileRelationResponse(BaseModel):
    relation_profile_id: uuid.UUID
    relation_name: str
    relation_type: str


class UploadFileItemResponse(BaseModel):
    file_path: str
    assigned: bool = False
    relations: list[UploadFileRelationResponse] = Field(default_factory=list)


class UserUploadResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    storage_batch_id: str
    upload_type: str
    file_paths: list[str] = Field(default_factory=list)
    files: list[UploadFileItemResponse] = Field(default_factory=list)
    file_count: int = 0
    source_submission_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    assigned_file_count: int = 0
    unassigned_file_count: int = 0
    bound_relations: list[UploadRelationBindingResponse] = Field(default_factory=list)


class AssignUploadRequest(BaseModel):
    relation_profile_id: uuid.UUID
    file_paths: list[str] = Field(default_factory=list)
    memory_scope: MemoryScope = "short_term"
