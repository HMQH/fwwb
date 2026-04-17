from __future__ import annotations

import base64
import time
from typing import Any

import httpx

from app.shared.core.config import settings


BAIDU_OAUTH_URL = "https://aip.baidubce.com/oauth/2.0/token"
BAIDU_ACCURATE_OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate"
_TOKEN_CACHE: dict[str, Any] = {
    "access_token": None,
    "expires_at": 0.0,
}


def _bool_flag(value: bool) -> str:
    return "true" if value else "false"


def _ocr_timeout_seconds() -> float:
    return max(3.0, float(settings.baidu_ocr_timeout_seconds))


def _get_access_token() -> str:
    cached = str(_TOKEN_CACHE.get("access_token") or "").strip()
    expires_at = float(_TOKEN_CACHE.get("expires_at") or 0.0)
    now = time.time()
    if cached and expires_at > now + 60:
        return cached

    api_key = str(settings.baidu_ocr_api_key or "").strip()
    secret_key = str(settings.baidu_ocr_secret_key or "").strip()
    if not api_key or not secret_key:
        raise RuntimeError("BAIDU_OCR_API_KEY and BAIDU_OCR_SECRET_KEY are required when OCR_PROVIDER=baidu")

    with httpx.Client(timeout=_ocr_timeout_seconds(), follow_redirects=True) as client:
        response = client.post(
            BAIDU_OAUTH_URL,
            params={
                "grant_type": "client_credentials",
                "client_id": api_key,
                "client_secret": secret_key,
            },
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict):
        raise RuntimeError("Baidu OCR token response is not a JSON object.")
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        error_description = str(payload.get("error_description") or payload.get("error") or "").strip()
        raise RuntimeError(f"Failed to obtain Baidu OCR access token. {error_description}".strip())

    expires_in = max(60, int(payload.get("expires_in") or 0))
    _TOKEN_CACHE["access_token"] = access_token
    _TOKEN_CACHE["expires_at"] = now + expires_in
    return access_token


def _build_request_payload(image_bytes: bytes) -> dict[str, str]:
    payload: dict[str, str] = {
        "image": base64.b64encode(image_bytes).decode("utf-8"),
        "language_type": settings.baidu_ocr_language_type,
        "detect_direction": _bool_flag(settings.baidu_ocr_detect_direction),
        "vertexes_location": _bool_flag(settings.baidu_ocr_vertexes_location),
        "paragraph": _bool_flag(settings.baidu_ocr_paragraph),
        "probability": _bool_flag(settings.baidu_ocr_probability),
        "recognize_granularity": settings.baidu_ocr_recognize_granularity,
        "multidirectional_recognize": _bool_flag(settings.baidu_ocr_multidirectional_recognize),
    }

    if settings.baidu_ocr_recognize_granularity == "small":
        payload["char_probability"] = _bool_flag(settings.baidu_ocr_char_probability)
        payload["eng_granularity"] = settings.baidu_ocr_eng_granularity

    return payload


def _normalize_word_result(item: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {
        "words": str(item.get("words") or ""),
    }
    for key in (
        "location",
        "chars",
        "probability",
        "vertexes_location",
        "finegrained_vertexes_location",
        "min_finegrained_vertexes_location",
    ):
        if key in item:
            normalized[key] = item.get(key)
    return normalized


def recognize_baidu_accurate(image_bytes: bytes, *, filename: str = "upload.png") -> dict[str, Any]:
    access_token = _get_access_token()
    with httpx.Client(
        timeout=_ocr_timeout_seconds(),
        follow_redirects=True,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    ) as client:
        response = client.post(
            BAIDU_ACCURATE_OCR_URL,
            params={"access_token": access_token},
            data=_build_request_payload(image_bytes),
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict):
        raise RuntimeError("Baidu OCR response is not a JSON object.")
    if payload.get("error_code") is not None:
        raise RuntimeError(
            f"Baidu OCR failed for {filename}: {payload.get('error_code')} {payload.get('error_msg')}"
        )

    words_result = payload.get("words_result")
    if not isinstance(words_result, list):
        words_result = []

    normalized_words: list[dict[str, Any]] = []
    lines: list[str] = []
    for item in words_result:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_word_result(item)
        normalized_words.append(normalized)
        text = str(normalized.get("words") or "").strip()
        if text:
            lines.append(text)

    result: dict[str, Any] = {
        "provider": "baidu",
        "engine": "accurate",
        "filename": filename,
        "log_id": payload.get("log_id"),
        "direction": payload.get("direction"),
        "words_result_num": int(payload.get("words_result_num") or len(normalized_words)),
        "words_result": normalized_words,
        "text": "\n".join(lines).strip(),
        "raw": payload,
    }
    if "paragraphs_result_num" in payload:
        result["paragraphs_result_num"] = payload.get("paragraphs_result_num")
    if "paragraphs_result" in payload:
        result["paragraphs_result"] = payload.get("paragraphs_result")
    if "pdf_file_size" in payload:
        result["pdf_file_size"] = payload.get("pdf_file_size")
    if "ofd_file_size" in payload:
        result["ofd_file_size"] = payload.get("ofd_file_size")
    return result
