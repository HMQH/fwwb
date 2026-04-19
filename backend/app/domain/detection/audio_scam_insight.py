"""基于阿里云 Qwen-Omni 的音频诈骗深度分析。"""
from __future__ import annotations

import base64
import json
import math
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.shared.core.config import settings
from app.shared.schemas.audio_scam_insight import AudioScamInsightResponse

_STAGE_META: dict[str, dict[str, str]] = {
    "contact_opening": {"label": "建立接触", "color": "#DCEBFF"},
    "trust_warming": {"label": "信任铺垫", "color": "#C7DAFF"},
    "authority_claim": {"label": "身份背书", "color": "#AFC8FF"},
    "risk_induction": {"label": "风险诱导", "color": "#FFD7B0"},
    "control_isolation": {"label": "控制隔离", "color": "#FFCAA0"},
    "command_control": {"label": "指令控制", "color": "#FFB98B"},
    "high_risk_action": {"label": "高危执行", "color": "#FF9B80"},
    "payment_push": {"label": "支付推动", "color": "#FF8D73"},
}
_SUPPORTED = {".wav": "wav", ".mp3": "mp3", ".m4a": "m4a", ".aac": "aac", ".ogg": "ogg", ".flac": "flac", ".amr": "amr", ".3gp": "3gp", ".3gpp": "3gpp"}
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_PLACEHOLDER_RE = re.compile(r"^[\s\?\uff1f\ufffd\u2026\.·:：,，;；!！\\/_\-\|]+$")
_TONES = {"info", "warning", "danger", "peak"}
_JOB_LOCK = threading.Lock()
_JOBS: dict[uuid.UUID, dict[str, Any]] = {}


_TAG_LABEL_MAP: dict[str, str] = {
    "calm_tone": "平稳语气",
    "urgent_tone": "紧迫语气",
    "pressure_tone": "施压语气",
    "command_tone": "命令语气",
    "dominant_speech": "主导发言",
    "repeated_emphasis": "反复强调",
    "high_pressure_speech": "高压输出",
    "sustained_pressure": "持续施压",
    "reassuring_language": "安抚性话术",
    "directive_language": "指令性话术",
    "imperative_language": "命令式表达",
    "identity_claim": "身份背书",
    "identity_disguise": "身份伪装",
    "trust_building": "信任建立",
    "trust_warming": "信任铺垫",
    "benefit_inducement": "利益诱导",
    "fake_solution": "虚假方案",
    "process_simplification": "流程简化",
    "link_introduction": "链接引导",
    "action_guidance": "行为引导",
    "operation_guidance": "操作引导",
    "information_request": "信息索取",
    "psychological_suggestion": "心理暗示",
    "information_blocking": "信息封锁",
    "security_emphasis": "安全强调",
    "step_confirmation": "步骤确认",
    "risk_induction": "风险诱导",
    "control_isolation": "控制隔离",
}
_TAG_TOKEN_MAP: dict[str, str] = {
    "calm": "平稳",
    "urgent": "紧迫",
    "pressure": "施压",
    "command": "命令",
    "dominant": "主导",
    "repeated": "反复",
    "emphasis": "强调",
    "high": "高",
    "sustained": "持续",
    "speech": "发言",
    "tone": "语气",
    "reassuring": "安抚",
    "directive": "指令性",
    "imperative": "命令式",
    "language": "话术",
    "identity": "身份",
    "claim": "背书",
    "disguise": "伪装",
    "trust": "信任",
    "building": "建立",
    "warming": "铺垫",
    "benefit": "利益",
    "inducement": "诱导",
    "fake": "虚假",
    "solution": "方案",
    "process": "流程",
    "simplification": "简化",
    "link": "链接",
    "introduction": "引导",
    "action": "行为",
    "operation": "操作",
    "guidance": "引导",
    "information": "信息",
    "request": "索取",
    "psychological": "心理",
    "suggestion": "暗示",
    "security": "安全",
    "step": "步骤",
    "confirmation": "确认",
    "risk": "风险",
    "control": "控制",
    "isolation": "隔离",
}
_LABEL_TRANSLATIONS: dict[str, str] = {
    "earliest_risk_signal": "最早风险显现",
    "risk_escalation": "风险升级点",
    "peak_risk": "峰值风险时刻",
    "earliest risk signal": "最早风险显现",
    "risk escalation": "风险升级点",
    "peak risk": "峰值风险时刻",
    "contact_opening": "建立接触",
    "trust_warming": "信任铺垫",
    "authority_claim": "身份背书",
    "risk_induction": "风险诱导",
    "control_isolation": "控制隔离",
    "command_control": "指令控制",
    "high_risk_action": "高危执行",
    "payment_push": "支付推动",
}

_SYSTEM_PROMPT = """
你是“诈骗通话深度分析助手”。

你的任务是根据输入音频，输出一个严格符合指定结构的 JSON，用于前端直接渲染“深度分析”页面。
重点不是复述全部对话内容，而是识别诈骗操控过程、风险阶段、关键证据与整体风险。

输出硬性要求：
1. 只能输出 JSON，不要输出 markdown，不要输出额外解释。
2. 所有 score / risk_score / confidence 都使用 0~1 小数。
3. 所有时间字段单位都是秒。
4. 所有时间边界必须满足：
   - 0 <= start_sec < end_sec <= total_duration_sec
   - 0 <= time_sec <= total_duration_sec
5. 枚举字段约束：
   - stage 只能取：contact_opening, trust_warming, authority_claim, risk_induction, control_isolation, command_control, high_risk_action, payment_push
   - tone 只能取：info, warning, danger, peak
   - risk_level 只能取：low, medium, high
6. 所有“直接展示给用户”的文本字段必须使用简体中文。
   只允许以下字段保留英文枚举：stage、tone、risk_level、id、color。
   其余如 label、summary、description、user_meaning、audio_tags、semantic_tags、cue_tags、explanation、suggested_actions 等，必须是简体中文。
7. 不要在展示字段中输出 snake_case、kebab-case、英文标签名或技术备注。
8. transcript_excerpt 如果无法可靠提取，可为空字符串；不要为了凑字数强行添加省略号。
9. 如果信息不足，也要尽量补全字段，不要缺字段，但不要编造过细的虚假细节。

分析重点：
- 音频行为：紧迫感、控制感、命令性、压迫度、说话风格与副语言线索
- 文本语义：身份伪装、利益诱导、信息索取、链接引导、支付推动等
- 过程演化：是否从普通接触逐步升级为操控型诈骗流程

请输出一个可直接被前端消费的结构化 JSON。
""".strip()

_EXAMPLE = {
    "behavior_profile": {
        "urgency_score": 0.46,
        "dominance_score": 0.71,
        "command_score": 0.74,
        "victim_compliance_score": 0.58,
        "speech_pressure_score": 0.63,
        "summary": "通话呈现由身份接触逐步升级为操作控制的风险轨迹，具备明显诈骗操控特征。",
    },
    "dynamics": {
        "total_duration_sec": 48.6,
        "earliest_risk_sec": 11.2,
        "escalation_sec": 24.8,
        "peak_risk_sec": 39.1,
        "stage_sequence": [
            {
                "id": "stage_1",
                "stage": "contact_opening",
                "label": "建立接触",
                "start_sec": 0.0,
                "end_sec": 10.8,
                "color": "#DCEBFF",
                "risk_score": 0.16,
                "summary": "对方以客服身份切入，建立沟通场景。",
                "cue_tags": ["身份伪装", "问题引入"],
            }
        ],
        "risk_curve": [{"time_sec": 5.0, "risk_score": 0.16}],
        "key_moments": [
            {
                "id": "moment_1",
                "label": "最早风险显现",
                "time_sec": 11.2,
                "stage_label": "风险诱导",
                "description": "对方开始以损失后果施压，引导用户继续操作。",
                "user_meaning": "用户在这一时刻进入更易被操控的状态。",
                "tone": "warning",
            }
        ],
    },
    "evidence_segments": [
        {
            "id": "evidence_1",
            "start_sec": 18.0,
            "end_sec": 26.0,
            "stage": "risk_induction",
            "stage_label": "风险诱导",
            "risk_score": 0.72,
            "transcript_excerpt": "您现在按提示操作，不处理的话今天还会继续扣费。",
            "audio_tags": ["紧迫语气", "主导发言"],
            "semantic_tags": ["风险诱导", "操作引导"],
            "explanation": "该片段同时出现施压和操作引导，风险显著上升。",
        }
    ],
    "decision": {
        "call_risk_score": 0.84,
        "risk_level": "high",
        "confidence": 0.9,
        "summary": "该通话已形成较完整的诈骗操控链条，整体风险较高。",
        "explanation": "对方通过身份包装、风险施压和操作指令逐步控制用户决策，符合高风险诈骗通话特征。",
        "suggested_actions": ["立即终止通话", "不要点击陌生链接", "通过官方渠道核实信息"],
    },
    "modality_contrib": {"audio_behavior": 0.34, "semantic_content": 0.33, "process_dynamics": 0.33},
}


class AudioScamInsightError(RuntimeError):
    pass


class AudioScamInsightNotReadyError(AudioScamInsightError):
    pass


class AudioScamInsightInputError(AudioScamInsightError):
    pass


class AudioScamInsightUpstreamError(AudioScamInsightError):
    pass


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_placeholder_text(text: str) -> bool:
    value = str(text or "").strip()
    return bool(value) and _PLACEHOLDER_RE.fullmatch(value) is not None


def _safe_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    if not text or _is_placeholder_text(text):
        return default
    return text


def _safe_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def _contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text or ""))


def _translate_tag(tag: str) -> str:
    normalized = _safe_text(tag).lower()
    if not normalized:
        return "未识别标签"
    if _contains_cjk(normalized):
        return tag.strip()
    if normalized in _TAG_LABEL_MAP:
        return _TAG_LABEL_MAP[normalized]
    parts = [part for part in re.split(r"[_\-\s]+", normalized) if part]
    translated = [_TAG_TOKEN_MAP.get(part, part) for part in parts]
    if any(_contains_cjk(part) for part in translated):
        return "".join(translated)
    return tag.strip()


def _normalize_display_tags(value: Any) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for item in _safe_list(value):
        translated = _translate_tag(item)
        if not translated or _is_placeholder_text(translated) or translated in seen:
            continue
        seen.add(translated)
        tags.append(translated)
    return tags


def _translate_label(text: Any, default: str) -> str:
    value = _safe_text(text, default)
    if _contains_cjk(value):
        return value
    lowered = value.lower()
    if lowered in _LABEL_TRANSLATIONS:
        return _LABEL_TRANSLATIONS[lowered]
    translated = _translate_tag(value)
    if _contains_cjk(translated):
        return translated
    return default


def _display_text(value: Any, default: str = "") -> str:
    text = _safe_text(value, default)
    if not text:
        return default
    if _contains_cjk(text):
        return text
    lowered = text.lower()
    if lowered in _LABEL_TRANSLATIONS:
        return _LABEL_TRANSLATIONS[lowered]
    translated = _translate_tag(text)
    if _contains_cjk(translated):
        return translated
    return text


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def _clamp(value: Any, default: float = 0.0) -> float:
    return max(0.0, min(1.0, _to_float(value, default)))


def _risk_level(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _stage_name(value: Any) -> str:
    text = _safe_text(value).lower()
    if text in _STAGE_META:
        return text
    mapping = {
        "contact": "contact_opening",
        "opening": "contact_opening",
        "建立接触": "contact_opening",
        "接触": "contact_opening",
        "开场": "contact_opening",
        "trust": "trust_warming",
        "warming": "trust_warming",
        "信任": "trust_warming",
        "铺垫": "trust_warming",
        "authority": "authority_claim",
        "身份": "authority_claim",
        "背书": "authority_claim",
        "risk": "risk_induction",
        "induction": "risk_induction",
        "风险": "risk_induction",
        "诱导": "risk_induction",
        "control": "control_isolation",
        "isolation": "control_isolation",
        "控制": "control_isolation",
        "隔离": "control_isolation",
        "command": "command_control",
        "指令": "command_control",
        "高压": "command_control",
        "high_risk": "high_risk_action",
        "action": "high_risk_action",
        "高危": "high_risk_action",
        "验证码": "high_risk_action",
        "执行": "high_risk_action",
        "payment": "payment_push",
        "支付": "payment_push",
        "转账": "payment_push",
    }
    for key, stage in mapping.items():
        if key in text:
            return stage
    return "contact_opening"


def _base_url() -> str:
    raw = _safe_text(settings.audio_scam_insight_base_url) or _safe_text(settings.detection_llm_api_url)
    raw = raw.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/embeddings"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]
            break
    if raw.endswith("/compatible-mode"):
        raw += "/v1"
    return raw


def _api_key() -> str:
    return _safe_text(settings.audio_scam_insight_api_key) or _safe_text(settings.detection_llm_api_key) or _safe_text(settings.rag_embedding_api_key)


def _mime_type(suffix: str) -> str:
    mime, _ = mimetypes.guess_type(f"x{suffix}")
    if mime:
        return mime
    return "audio/mp4" if suffix == ".m4a" else "audio/wav"


def _audio_duration_sec(audio_path: str) -> float:
    try:
        from app.domain.detection.audio_feature_extractor import TARGET_SR, load_audio

        x = load_audio(audio_path)
        return round(len(x) / TARGET_SR, 3)
    except Exception:
        return 0.0


def _extract_json(raw_content: str) -> dict[str, Any]:
    text = raw_content.strip()
    if not text:
        raise AudioScamInsightUpstreamError("模型返回为空")
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass
    match = _JSON_BLOCK_RE.search(text)
    if match is None:
        raise AudioScamInsightUpstreamError("模型返回中未找到 JSON")
    payload = json.loads(match.group(0))
    if not isinstance(payload, dict):
        raise AudioScamInsightUpstreamError("模型 JSON 不是对象")
    return payload


def _extract_message_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, list):
        parts: list[str] = []
        for item in payload:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            if item.get("type") in {"text", "output_text"} and item.get("text"):
                parts.append(str(item["text"]))
                continue
            if isinstance(item.get("content"), str):
                parts.append(str(item["content"]))
        return "".join(parts).strip()
    if isinstance(payload, dict):
        if isinstance(payload.get("text"), str):
            return str(payload["text"]).strip()
        if isinstance(payload.get("content"), str):
            return str(payload["content"]).strip()
    return ""


def _call_model(*, data_uri: str, audio_format: str, filename: str, duration_sec: float, language_hint: str, json_mode: bool) -> dict[str, Any]:
    api_key = _api_key()
    if not api_key:
        raise AudioScamInsightNotReadyError("\u672a\u914d\u7f6e\u963f\u91cc\u4e91 API Key\u3002\u8bf7\u5728 .env \u4e2d\u8bbe\u7f6e AUDIO_SCAM_INSIGHT_API_KEY \u6216 DETECTION_LLM_API_KEY\u3002")

    base_url = _base_url()
    if not base_url:
        raise AudioScamInsightNotReadyError("\u672a\u914d\u7f6e\u8bed\u97f3\u6df1\u5ea6\u5206\u6790\u63a5\u53e3\u5730\u5740\u3002")

    user_prompt = (
        f"\u8bf7\u5206\u6790\u8fd9\u6bb5\u97f3\u9891\uff0c\u5e76\u4e25\u683c\u8f93\u51fa JSON\u3002\n"
        f"filename: {filename or 'uploaded_audio'}\n"
        f"duration_sec: {duration_sec}\n"
        f"language_hint: {language_hint or settings.audio_scam_insight_language_hint}\n"
        "\u6ce8\u610f\uff1a\u6240\u6709\u7ed9\u524d\u7aef\u76f4\u63a5\u5c55\u793a\u7684\u6587\u672c\u5b57\u6bb5\u5fc5\u987b\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587\uff0c\u4e0d\u8981\u8f93\u51fa\u82f1\u6587\u6807\u7b7e\u3001snake_case \u6587\u672c\u6216\u5360\u4f4d\u7b26\u3002\n"
        f"\u8f93\u51fa\u7ed3\u6784\u793a\u4f8b\uff1a{json.dumps(_EXAMPLE, ensure_ascii=False)}"
    )
    request_payload: dict[str, Any] = {
        "model": settings.audio_scam_insight_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "input_audio", "input_audio": {"data": data_uri, "format": audio_format}},
                ],
            },
        ],
        "modalities": ["text"],
        "temperature": settings.audio_scam_insight_temperature,
        "max_tokens": settings.audio_scam_insight_max_tokens,
    }
    if json_mode:
        request_payload["response_format"] = {"type": "json_object"}

    try:
        response = httpx.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_payload,
            timeout=settings.audio_scam_insight_timeout_seconds,
        )
        response.raise_for_status()
        response_payload = response.json()

        choices = response_payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise AudioScamInsightUpstreamError("\u6a21\u578b\u54cd\u5e94\u7f3a\u5c11 choices")
        first_choice = choices[0] if isinstance(choices[0], dict) else {}
        message = first_choice.get("message") if isinstance(first_choice, dict) else {}
        raw_text = _extract_message_text(message.get("content") if isinstance(message, dict) else None)
        if not raw_text:
            raise AudioScamInsightUpstreamError("\u6a21\u578b\u54cd\u5e94\u7f3a\u5c11\u53ef\u89e3\u6790\u5185\u5bb9")
        return _extract_json(raw_text)
    except AudioScamInsightError:
        raise
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:400] if exc.response is not None else str(exc)
        raise AudioScamInsightUpstreamError(f"Qwen-Omni \u54cd\u5e94\u5f02\u5e38: {detail}") from exc
    except httpx.HTTPError as exc:
        raise AudioScamInsightUpstreamError(f"Qwen-Omni \u8bf7\u6c42\u5931\u8d25: {exc}") from exc
    except ValueError as exc:
        raise AudioScamInsightUpstreamError(f"Qwen-Omni \u8fd4\u56de\u4e86\u65e0\u6548 JSON: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise AudioScamInsightUpstreamError(f"Qwen-Omni \u8bf7\u6c42\u5931\u8d25: {exc}") from exc

def _estimate_total_duration(payload: dict[str, Any], raw_dynamics: dict[str, Any], duration_sec: float) -> float:
    candidates = [max(duration_sec, 0.0), max(_to_float(raw_dynamics.get("total_duration_sec"), 0.0), 0.0)]
    for key in ("earliest_risk_sec", "escalation_sec", "peak_risk_sec"):
        candidates.append(max(_to_float(raw_dynamics.get(key), 0.0), 0.0))
    for item in raw_dynamics.get("stage_sequence") if isinstance(raw_dynamics.get("stage_sequence"), list) else []:
        if isinstance(item, dict):
            candidates.append(max(_to_float(item.get("start_sec"), 0.0), 0.0))
            candidates.append(max(_to_float(item.get("end_sec"), 0.0), 0.0))
    for item in payload.get("evidence_segments") if isinstance(payload.get("evidence_segments"), list) else []:
        if isinstance(item, dict):
            candidates.append(max(_to_float(item.get("start_sec"), 0.0), 0.0))
            candidates.append(max(_to_float(item.get("end_sec"), 0.0), 0.0))
    for item in raw_dynamics.get("risk_curve") if isinstance(raw_dynamics.get("risk_curve"), list) else []:
        if isinstance(item, dict):
            candidates.append(max(_to_float(item.get("time_sec"), 0.0), 0.0))
    for item in raw_dynamics.get("key_moments") if isinstance(raw_dynamics.get("key_moments"), list) else []:
        if isinstance(item, dict):
            candidates.append(max(_to_float(item.get("time_sec"), 0.0), 0.0))
    total = max(candidates) if candidates else 0.0
    return round(max(total, 1.0), 3)


def _clip_interval(start_sec: float, end_sec: float, total_duration: float) -> tuple[float, float]:
    min_span = 0.001
    start = min(max(start_sec, 0.0), total_duration)
    end = min(max(end_sec, 0.0), total_duration)
    if end <= start:
        if total_duration - start >= min_span:
            end = start + min_span
        else:
            start = max(0.0, total_duration - min_span)
            end = total_duration
    return round(start, 3), round(min(end, total_duration), 3)


def _dedupe_id(preferred: str, fallback_prefix: str, index: int, seen: set[str]) -> str:
    candidate = _safe_text(preferred, f"{fallback_prefix}_{index}")
    if candidate not in seen:
        seen.add(candidate)
        return candidate
    seq = 2
    while f"{candidate}_{seq}" in seen:
        seq += 1
    resolved = f"{candidate}_{seq}"
    seen.add(resolved)
    return resolved


def _find_stage_by_time(stages: list[dict[str, Any]], time_sec: float) -> dict[str, Any] | None:
    for stage in stages:
        if stage["start_sec"] <= time_sec <= stage["end_sec"]:
            return stage
    if not stages:
        return None
    if time_sec < stages[0]["start_sec"]:
        return stages[0]
    return stages[-1]


def _normalize_stage_sequence(raw_dynamics: dict[str, Any], total_duration: float) -> list[dict[str, Any]]:
    raw_stages = raw_dynamics.get("stage_sequence") if isinstance(raw_dynamics.get("stage_sequence"), list) else []
    parsed: list[dict[str, Any]] = []
    fallback_span = max(total_duration / max(len(raw_stages), 1), 4.0)
    for idx, item in enumerate(raw_stages, start=1):
        if not isinstance(item, dict):
            continue
        stage = _stage_name(item.get("stage") or item.get("label"))
        meta = _STAGE_META[stage]
        start = max(_to_float(item.get("start_sec"), (idx - 1) * fallback_span), 0.0)
        end = max(_to_float(item.get("end_sec"), start + fallback_span), 0.0)
        parsed.append(
            {
                "id": _safe_text(item.get("id"), f"stage_{idx}"),
                "stage": stage,
                "label": meta["label"],
                "start_sec": start,
                "end_sec": end,
                "color": meta["color"],
                "risk_score": _clamp(item.get("risk_score"), 0.15 + 0.1 * idx),
                "summary": _display_text(item.get("summary"), f"{meta['label']}阶段风险逐步形成。"),
                "cue_tags": _normalize_display_tags(item.get("cue_tags")),
            }
        )

    parsed.sort(key=lambda item: (item["start_sec"], item["end_sec"], item["id"]))
    if not parsed:
        return [{
            "id": "stage_1",
            "stage": "contact_opening",
            "label": _STAGE_META["contact_opening"]["label"],
            "start_sec": 0.0,
            "end_sec": round(total_duration, 3),
            "color": _STAGE_META["contact_opening"]["color"],
            "risk_score": 0.2,
            "summary": "通话仍处于初始接触阶段，暂未形成清晰的高危操控链条。",
            "cue_tags": [],
        }]

    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    cursor = 0.0
    for idx, item in enumerate(parsed, start=1):
        start = max(cursor, min(max(item["start_sec"], 0.0), total_duration))
        end = min(max(item["end_sec"], start + 0.001), total_duration)
        start, end = _clip_interval(start, end, total_duration)
        cursor = end
        normalized.append(
            {
                **item,
                "id": _dedupe_id(item["id"], "stage", idx, seen_ids),
                "start_sec": start,
                "end_sec": end,
                "label": _STAGE_META[item["stage"]]["label"],
                "color": _STAGE_META[item["stage"]]["color"],
            }
        )

    normalized[0]["start_sec"] = 0.0
    normalized[-1]["end_sec"] = round(total_duration, 3)
    for idx in range(1, len(normalized)):
        if normalized[idx]["start_sec"] < normalized[idx - 1]["end_sec"]:
            normalized[idx]["start_sec"] = normalized[idx - 1]["end_sec"]
            normalized[idx]["start_sec"], normalized[idx]["end_sec"] = _clip_interval(
                normalized[idx]["start_sec"], normalized[idx]["end_sec"], total_duration
            )
    return normalized


def _normalize_evidence_segments(payload: dict[str, Any], stages: list[dict[str, Any]], total_duration: float) -> list[dict[str, Any]]:
    raw_evidence = payload.get("evidence_segments") if isinstance(payload.get("evidence_segments"), list) else []
    evidence: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_evidence, start=1):
        if not isinstance(item, dict):
            continue
        start = _to_float(item.get("start_sec"), 0.0)
        end = _to_float(item.get("end_sec"), start + 5.0)
        start, end = _clip_interval(start, end, total_duration)
        midpoint = round((start + end) / 2, 3)
        linked_stage = _find_stage_by_time(stages, midpoint)
        stage_name = linked_stage["stage"] if linked_stage is not None else _stage_name(item.get("stage") or item.get("stage_label"))
        evidence.append(
            {
                "id": _safe_text(item.get("id"), f"evidence_{idx}"),
                "start_sec": start,
                "end_sec": end,
                "stage": stage_name,
                "stage_label": _STAGE_META[stage_name]["label"],
                "risk_score": _clamp(item.get("risk_score"), 0.6),
                "transcript_excerpt": _safe_text(item.get("transcript_excerpt")),
                "audio_tags": _normalize_display_tags(item.get("audio_tags")),
                "semantic_tags": _normalize_display_tags(item.get("semantic_tags")),
                "explanation": _display_text(item.get("explanation"), "该片段包含较强风险线索，可作为关键证据参考。"),
            }
        )
    if not evidence:
        for idx, stage in enumerate([s for s in stages if s["risk_score"] >= 0.65][:3], start=1):
            start, end = _clip_interval(stage["start_sec"], min(stage["end_sec"], stage["start_sec"] + 8.0), total_duration)
            evidence.append(
                {
                    "id": f"evidence_{idx}",
                    "start_sec": start,
                    "end_sec": end,
                    "stage": stage["stage"],
                    "stage_label": stage["label"],
                    "risk_score": stage["risk_score"],
                    "transcript_excerpt": "",
                    "audio_tags": list(stage["cue_tags"]),
                    "semantic_tags": [],
                    "explanation": stage["summary"],
                }
            )
    evidence.sort(key=lambda item: (item["start_sec"], item["end_sec"], item["id"]))
    seen_ids: set[str] = set()
    for idx, item in enumerate(evidence, start=1):
        item["id"] = _dedupe_id(item["id"], "evidence", idx, seen_ids)
        linked_stage = _find_stage_by_time(stages, round((item["start_sec"] + item["end_sec"]) / 2, 3))
        if linked_stage is not None:
            item["stage"] = linked_stage["stage"]
            item["stage_label"] = linked_stage["label"]
        item["start_sec"], item["end_sec"] = _clip_interval(item["start_sec"], item["end_sec"], total_duration)
    return evidence


def _normalize_risk_curve(raw_dynamics: dict[str, Any], stages: list[dict[str, Any]], total_duration: float) -> list[dict[str, Any]]:
    raw_curve = raw_dynamics.get("risk_curve") if isinstance(raw_dynamics.get("risk_curve"), list) else []
    points: list[dict[str, Any]] = []
    for item in raw_curve:
        if isinstance(item, dict):
            points.append(
                {
                    "time_sec": round(min(max(_to_float(item.get("time_sec"), 0.0), 0.0), total_duration), 3),
                    "risk_score": _clamp(item.get("risk_score"), 0.0),
                }
            )
    if not points:
        points = [{"time_sec": round((stage["start_sec"] + stage["end_sec"]) / 2, 3), "risk_score": stage["risk_score"]} for stage in stages]
        if len(points) == 1:
            points.append({"time_sec": round(total_duration, 3), "risk_score": points[0]["risk_score"]})
    points.sort(key=lambda item: (item["time_sec"], item["risk_score"]))
    deduped: list[dict[str, Any]] = []
    for point in points:
        if deduped and deduped[-1]["time_sec"] == point["time_sec"]:
            deduped[-1]["risk_score"] = max(deduped[-1]["risk_score"], point["risk_score"])
        else:
            deduped.append(point)
    return deduped


def _derive_key_times(stages: list[dict[str, Any]], evidence: list[dict[str, Any]], risk_curve: list[dict[str, Any]], total_duration: float) -> tuple[float, float, float]:
    earliest = next((stage["start_sec"] for stage in stages if stage["risk_score"] >= 0.45), evidence[0]["start_sec"] if evidence else 0.0)
    escalation = next((point["time_sec"] for point in risk_curve if point["risk_score"] >= 0.72), earliest)
    peak = max(risk_curve, key=lambda point: point["risk_score"])["time_sec"] if risk_curve else total_duration
    earliest = min(max(earliest, 0.0), total_duration)
    escalation = min(max(escalation, earliest), total_duration)
    peak = min(max(peak, 0.0), total_duration)
    return round(earliest, 3), round(escalation, 3), round(peak, 3)


def _normalize_key_moments(raw_dynamics: dict[str, Any], stages: list[dict[str, Any]], total_duration: float, earliest: float, escalation: float, peak: float) -> list[dict[str, Any]]:
    raw_moments = raw_dynamics.get("key_moments") if isinstance(raw_dynamics.get("key_moments"), list) else []
    moments: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_moments, start=1):
        if not isinstance(item, dict):
            continue
        time_sec = round(min(max(_to_float(item.get("time_sec"), 0.0), 0.0), total_duration), 3)
        linked_stage = _find_stage_by_time(stages, time_sec)
        tone = _safe_text(item.get("tone"), "warning")
        if tone not in _TONES:
            tone = "warning"
        moments.append(
            {
                "id": _safe_text(item.get("id"), f"moment_{idx}"),
                "label": _translate_label(item.get("label"), f"关键时刻 {idx}"),
                "time_sec": time_sec,
                "stage_label": linked_stage["label"] if linked_stage is not None else stages[-1]["label"],
                "description": _display_text(item.get("description"), "该时刻风险线索开始集中显现。"),
                "user_meaning": _display_text(item.get("user_meaning"), "用户在该时刻更容易受到对方引导。"),
                "tone": tone,
            }
        )
    if not moments:
        defaults = [
            ("moment_1", "最早风险显现", earliest, "通话在这一时刻出现初步风险操控信号。", "用户开始进入更易被引导的状态。", "warning"),
            ("moment_2", "风险升级点", escalation, "风险在这一阶段明显升级，操控意图更清晰。", "用户一旦继续配合，受损概率会进一步上升。", "danger"),
            ("moment_3", "峰值风险时刻", peak, "风险强度在这一时刻达到峰值。", "用户此时最需要停止操作并重新核实信息。", "peak"),
        ]
        for moment_id, label, time_sec, description, user_meaning, tone in defaults:
            linked_stage = _find_stage_by_time(stages, time_sec)
            moments.append(
                {
                    "id": moment_id,
                    "label": label,
                    "time_sec": round(time_sec, 3),
                    "stage_label": linked_stage["label"] if linked_stage is not None else stages[-1]["label"],
                    "description": description,
                    "user_meaning": user_meaning,
                    "tone": tone,
                }
            )
    moments.sort(key=lambda item: (item["time_sec"], item["id"]))
    seen_ids: set[str] = set()
    for idx, item in enumerate(moments, start=1):
        item["id"] = _dedupe_id(item["id"], "moment", idx, seen_ids)
        linked_stage = _find_stage_by_time(stages, item["time_sec"])
        if linked_stage is not None:
            item["stage_label"] = linked_stage["label"]
    return moments


def _normalize(payload: dict[str, Any], *, duration_sec: float) -> AudioScamInsightResponse:
    raw_dynamics = payload.get("dynamics") if isinstance(payload.get("dynamics"), dict) else {}
    total_duration = _estimate_total_duration(payload, raw_dynamics, duration_sec)
    stages = _normalize_stage_sequence(raw_dynamics, total_duration)
    evidence = _normalize_evidence_segments(payload, stages, total_duration)

    raw_profile = payload.get("behavior_profile") if isinstance(payload.get("behavior_profile"), dict) else {}
    behavior = {
        "urgency_score": _clamp(raw_profile.get("urgency_score"), 0.72 if any(s["stage"] in {"risk_induction", "payment_push", "high_risk_action"} for s in stages) else 0.25),
        "dominance_score": _clamp(raw_profile.get("dominance_score"), 0.7 if any(s["stage"] in {"control_isolation", "command_control"} for s in stages) else 0.24),
        "command_score": _clamp(raw_profile.get("command_score"), 0.8 if any(s["stage"] in {"command_control", "high_risk_action"} for s in stages) else 0.22),
        "victim_compliance_score": _clamp(raw_profile.get("victim_compliance_score"), 0.55 if evidence else 0.28),
        "speech_pressure_score": _clamp(raw_profile.get("speech_pressure_score"), 0.74 if any(s["risk_score"] >= 0.75 for s in stages) else 0.3),
        "summary": _display_text(raw_profile.get("summary"), "该通话存在一定风险操控迹象，建议结合关键阶段与证据片段进一步判断。"),
    }

    risk_curve = _normalize_risk_curve(raw_dynamics, stages, total_duration)
    earliest, escalation, peak = _derive_key_times(stages, evidence, risk_curve, total_duration)
    moments = _normalize_key_moments(raw_dynamics, stages, total_duration, earliest, escalation, peak)

    raw_decision = payload.get("decision") if isinstance(payload.get("decision"), dict) else {}
    score = _clamp(raw_decision.get("call_risk_score"), max(max((s["risk_score"] for s in stages), default=0.2), max((e["risk_score"] for e in evidence), default=0.2)))
    risk_level = _safe_text(raw_decision.get("risk_level"), _risk_level(score)).lower()
    if risk_level not in {"low", "medium", "high"}:
        risk_level = _risk_level(score)
    decision = {
        "call_risk_score": score,
        "risk_level": risk_level,
        "confidence": _clamp(raw_decision.get("confidence"), 0.84 if risk_level == "high" else 0.68 if risk_level == "medium" else 0.52),
        "summary": _display_text(raw_decision.get("summary"), behavior["summary"]),
        "explanation": _display_text(raw_decision.get("explanation"), "综合音频行为、语义线索与过程演化后，该通话呈现明显的风险升级趋势。"),
        "suggested_actions": [_display_text(item) for item in _safe_list(raw_decision.get("suggested_actions"))] or (["立即终止通话", "不要继续转账或提供验证码", "通过官方渠道核实信息"] if risk_level == "high" else ["暂停操作并核实对方身份", "避免点击陌生链接或下载陌生应用"] if risk_level == "medium" else ["保持警惕，并继续通过正规渠道核实信息"]),
    }

    raw_contrib = payload.get("modality_contrib") if isinstance(payload.get("modality_contrib"), dict) else {}
    contrib = {
        "audio_behavior": max(0.0, _to_float(raw_contrib.get("audio_behavior"), 0.34)),
        "semantic_content": max(0.0, _to_float(raw_contrib.get("semantic_content"), 0.33)),
        "process_dynamics": max(0.0, _to_float(raw_contrib.get("process_dynamics"), 0.33)),
    }
    total = sum(contrib.values()) or 1.0
    contrib = {k: round(v / total, 4) for k, v in contrib.items()}

    return AudioScamInsightResponse.model_validate({
        "behavior_profile": behavior,
        "dynamics": {"total_duration_sec": total_duration, "earliest_risk_sec": earliest, "escalation_sec": escalation, "peak_risk_sec": peak, "stage_sequence": stages, "risk_curve": risk_curve, "key_moments": moments},
        "evidence_segments": evidence,
        "decision": decision,
        "modality_contrib": contrib,
    })


def analyze_file(audio_path: str, *, filename: str | None = None, language_hint: str | None = None) -> dict[str, Any]:
    path = Path(audio_path)
    if not path.exists():
        raise AudioScamInsightInputError(f"音频文件不存在: {audio_path}")
    suffix = (path.suffix or ".wav").lower()
    if suffix not in _SUPPORTED:
        raise AudioScamInsightInputError("暂不支持的音频格式，请上传 wav/mp3/m4a/aac/ogg/flac/amr/3gp 文件。")
    data = path.read_bytes()
    max_bytes = min(settings.max_upload_bytes, settings.audio_scam_insight_max_file_bytes)
    if len(data) > max_bytes:
        raise AudioScamInsightInputError(f"音频文件过大，当前接口建议控制在 {max_bytes} 字节以内。")
    data_uri = f"data:{_mime_type(suffix)};base64,{base64.b64encode(data).decode('utf-8')}"
    duration_sec = _audio_duration_sec(audio_path)

    last_error: Exception | None = None
    for json_mode in (True, False):
        try:
            payload = _call_model(data_uri=data_uri, audio_format=_SUPPORTED[suffix], filename=filename or path.name, duration_sec=duration_sec, language_hint=language_hint or settings.audio_scam_insight_language_hint, json_mode=json_mode)
            return _normalize(payload, duration_sec=duration_sec).model_dump()
        except AudioScamInsightUpstreamError as exc:
            last_error = exc
            if json_mode:
                continue
            raise
    if last_error is not None:
        raise last_error
    raise AudioScamInsightUpstreamError("音频诈骗深度分析失败")


def create_job(*, user_id: uuid.UUID, filename: str | None) -> dict[str, Any]:
    now = _now_utc()
    job_id = uuid.uuid4()
    record = {"job_id": job_id, "user_id": user_id, "filename": filename, "status": "pending", "created_at": now, "updated_at": now, "error_message": None, "result": None}
    with _JOB_LOCK:
        _JOBS[job_id] = record
    return dict(record)


def ensure_job_owner(job_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any] | None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None or record["user_id"] != user_id:
            return None
        return dict(record)


def _update_job(job_id: uuid.UUID, **fields: Any) -> None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        record.update(fields)
        record["updated_at"] = _now_utc()


def process_job(job_id: uuid.UUID, audio_path: str, *, filename: str | None = None, language_hint: str | None = None) -> None:
    _update_job(job_id, status="running", error_message=None)
    try:
        result = analyze_file(audio_path, filename=filename, language_hint=language_hint)
    except Exception as exc:  # noqa: BLE001
        _update_job(job_id, status="failed", error_message=str(exc), result=None)
    else:
        _update_job(job_id, status="completed", error_message=None, result=result)
    finally:
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except OSError:
            pass
