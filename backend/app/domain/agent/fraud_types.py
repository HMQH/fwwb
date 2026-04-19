"""诈骗类型：对外统一使用中文展示名，并兼容历史英文枚举。"""

from __future__ import annotations

from typing import Any

# 写入 API / 持久化的中文展示值
FRAUD_TYPE_SUSPICIOUS_QR = "可疑二维码"
FRAUD_TYPE_IMPERSONATION = "盗图冒充"
FRAUD_TYPE_FORGED_DOC = "仿冒公文"
FRAUD_TYPE_PHISHING_IMAGE = "钓鱼图片"
FRAUD_TYPE_PII = "敏感信息泄露"
FRAUD_TYPE_PHISHING_SITE = "钓鱼网站"
FRAUD_TYPE_VOICE_SCAM_CALL = "语音诈骗来电"
FRAUD_TYPE_UNKNOWN = "未知"

_LEGACY_CODE_TO_ZH: dict[str, str] = {
    "suspicious_qr": FRAUD_TYPE_SUSPICIOUS_QR,
    "impersonation_or_stolen_image": FRAUD_TYPE_IMPERSONATION,
    "forged_official_document": FRAUD_TYPE_FORGED_DOC,
    "phishing_image": FRAUD_TYPE_PHISHING_IMAGE,
    "sensitive_information_exposure": FRAUD_TYPE_PII,
    "phishing_site": FRAUD_TYPE_PHISHING_SITE,
    "voice_scam_call": FRAUD_TYPE_VOICE_SCAM_CALL,
    "unknown": FRAUD_TYPE_UNKNOWN,
}

_ZH_CANONICAL: frozenset[str] = frozenset(_LEGACY_CODE_TO_ZH.values())


def normalize_fraud_type_display(value: Any) -> str | None:
    """将历史英文 code 或混用写法转为中文展示名；已是中文则原样返回（若属于已知集合）。"""
    text = str(value or "").strip()
    if not text:
        return None
    if text in _ZH_CANONICAL:
        return text
    key = text.lower().replace(" ", "_").replace("-", "_")
    mapped = _LEGACY_CODE_TO_ZH.get(key)
    if mapped:
        return mapped
    return text


def is_qr_fraud_type(value: Any) -> bool:
    """是否与二维码主导分支对应（兼容旧英文）。"""
    text = str(value or "").strip()
    if not text:
        return False
    if text == FRAUD_TYPE_SUSPICIOUS_QR:
        return True
    return text.lower() == "suspicious_qr"


_MODALITY_TO_ZH: dict[str, str] = {
    "audio": "音频",
    "video": "视频",
}


def format_unsupported_modalities_zh(modalities: list[str]) -> str:
    """用于用户可见文案中的模态列表。"""
    parts: list[str] = []
    for raw in modalities:
        key = str(raw or "").strip().lower()
        parts.append(_MODALITY_TO_ZH.get(key, str(raw or "").strip() or key))
    return "、".join(parts)
