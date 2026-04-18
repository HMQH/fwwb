"""认证相关请求/响应模型。"""
from __future__ import annotations

import re
from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.shared.user_roles import UserRole

_PHONE_RE = re.compile(r"^1\d{10}$")
GuardianRelation = Literal["self", "parent", "spouse", "child", "relative"]
PushPlatform = Literal["android", "ios", "web", "unknown"]


class RegisterRequest(BaseModel):
    phone: str = Field(..., min_length=11, max_length=11)
    password: str = Field(..., min_length=8, max_length=128)
    password_confirm: str = Field(..., min_length=8, max_length=128)
    birth_date: date
    display_name: str = Field(..., min_length=1, max_length=64)
    role: UserRole
    agree_terms: bool = False

    @field_validator("phone")
    @classmethod
    def phone_cn(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("手机号须为 11 位且以 1 开头")
        return v

    @model_validator(mode="after")
    def passwords_and_terms(self) -> RegisterRequest:
        if self.password != self.password_confirm:
            raise ValueError("两次输入的密码不一致")
        if not self.agree_terms:
            raise ValueError("须同意用户协议与隐私政策")
        return self


class LoginRequest(BaseModel):
    phone: str = Field(..., min_length=11, max_length=11)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("phone")
    @classmethod
    def phone_cn(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("手机号须为 11 位且以 1 开头")
        return v


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    phone: str
    display_name: str
    role: str
    birth_date: date
    avatar_url: str | None = None
    guardian_relation: GuardianRelation | None = None
    profile_summary: str | None = None
    safety_score: int = 95
    memory_urgency_score: int = 0


class UpdateGuardianRequest(BaseModel):
    guardian_relation: GuardianRelation


class RegisterPushTokenRequest(BaseModel):
    expo_push_token: str = Field(..., min_length=16, max_length=256)
    platform: PushPlatform = "unknown"
    device_name: str | None = Field(default=None, max_length=128)


class PushTokenResponse(BaseModel):
    expo_push_token: str
    platform: PushPlatform
    device_name: str | None = None
    is_active: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
