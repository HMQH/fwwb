from __future__ import annotations

import re
from typing import Any

_PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d{9})(?!\d)")
_ID_CARD_RE = re.compile(r"(?<!\d)(\d{17}[\dXx])(?!\d)")
_BANK_CARD_RE = re.compile(r"(?<!\d)(\d{12,19})(?!\d)")
_CODE_RE = re.compile(
    r"(?:验证码|校验码|动态码|短信码|口令|提取码|安全码)[^\dA-Za-z]{0,6}([A-Za-z0-9]{4,8})",
    re.IGNORECASE,
)


def _mask_value(value: str) -> str:
    text = str(value or "").strip()
    if len(text) <= 4:
        return text
    if len(text) <= 8:
        return text[:2] + "*" * (len(text) - 4) + text[-2:]
    return text[:3] + "*" * max(1, len(text) - 7) + text[-4:]


def _luhn_valid(number: str) -> bool:
    digits = [int(ch) for ch in str(number) if ch.isdigit()]
    if len(digits) < 12:
        return False
    checksum = 0
    parity = len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def _append_hit(hits: list[dict[str, Any]], *, hit_type: str, value: str) -> None:
    masked = _mask_value(value)
    key = (hit_type, masked)
    existed = {
        (str(item.get("type") or "").strip(), str(item.get("value") or "").strip())
        for item in hits
        if isinstance(item, dict)
    }
    if key in existed:
        return
    hits.append({"type": hit_type, "value": masked})


def detect_sensitive_items(text: str | None) -> dict[str, Any]:
    content = str(text or "").strip()
    hits: list[dict[str, Any]] = []
    if not content:
        return {"hits": []}

    for match in _PHONE_RE.finditer(content):
        _append_hit(hits, hit_type="phone", value=match.group(1))

    for match in _ID_CARD_RE.finditer(content):
        _append_hit(hits, hit_type="id_card", value=match.group(1))

    for match in _BANK_CARD_RE.finditer(content):
        candidate = match.group(1)
        if _luhn_valid(candidate):
            _append_hit(hits, hit_type="bank_card", value=candidate)

    for match in _CODE_RE.finditer(content):
        _append_hit(hits, hit_type="verification_code", value=match.group(1))

    return {"hits": hits}
