"""密码哈希与 JWT：均为标准库实现（PBKDF2-HMAC-SHA256 + HS256），无 bcrypt/PyJWT 依赖。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any
from uuid import UUID

from app.core.config import settings

# 迭代次数：演示环境可接受；生产可酌情调高
_PBKDF2_ITERATIONS = 210_000


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + pad)


def hash_password(plain: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        plain.encode("utf-8"),
        salt,
        _PBKDF2_ITERATIONS,
        dklen=32,
    )
    return "pbkdf2_sha256$%d$%s$%s" % (
        _PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(dk).decode("ascii"),
    )


def verify_password(plain: str, stored: str) -> bool:
    if not stored.startswith("pbkdf2_sha256$"):
        return False
    try:
        _, iters_s, salt_b64, hash_b64 = stored.split("$", 3)
        iters = int(iters_s)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
    except (ValueError, TypeError):
        return False
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        plain.encode("utf-8"),
        salt,
        iters,
        dklen=len(expected),
    )
    return hmac.compare_digest(dk, expected)


def create_access_token(
    subject_user_id: UUID, extra_claims: dict[str, Any] | None = None
) -> str:
    exp = int(time.time()) + int(settings.access_token_expire_minutes * 60)
    payload: dict[str, Any] = {"sub": str(subject_user_id), "exp": exp}
    if extra_claims:
        payload.update(extra_claims)
    header = {"alg": settings.jwt_algorithm, "typ": "JWT"}
    h = _b64url_encode(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    p = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{h}.{p}".encode("ascii")
    sig = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{h}.{p}.{_b64url_encode(sig)}"


def decode_token(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("令牌格式无效")
    h_b64, p_b64, s_b64 = parts
    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    expected = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(_b64url_encode(expected), s_b64):
        raise ValueError("令牌签名校验失败")
    payload = json.loads(_b64url_decode(p_b64).decode("utf-8"))
    exp = payload.get("exp")
    if exp is not None and int(exp) < int(time.time()):
        raise ValueError("令牌已过期")
    return payload


def parse_user_id_from_token(token: str) -> UUID | None:
    try:
        data = decode_token(token)
        sub = data.get("sub")
        if not sub:
            return None
        return UUID(str(sub))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
