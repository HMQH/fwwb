"""认证相关请求/响应模型。"""
from __future__ import annotations

import re
from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_PHONE_RE = re.compile(r"^1\d{10}$")


class RegisterRequest(BaseModel):
    phone: str = Field(..., min_length=11, max_length=11)
    password: str = Field(..., min_length=8, max_length=128)
    password_confirm: str = Field(..., min_length=8, max_length=128)
    birth_date: date
    display_name: str = Field(..., min_length=1, max_length=64)
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


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
