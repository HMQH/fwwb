from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.domain.agent.skills.impersonation_checker import run_impersonation_checker
from app.domain.agent.skills.ocr_phishing import run_ocr_phishing
from app.domain.agent.skills.official_document_checker import run_official_document_checker
from app.domain.agent.skills.pii_guard import run_pii_guard
from app.domain.agent.skills.qr_inspector import run_qr_inspector
from app.domain.agent.tools.ocr_tool import extract_texts
from app.domain.ai_face import service as ai_face_service
from app.domain.assistant.entity import AssistantMessage
from app.domain.detection import service as detection_service
from app.domain.detection.audio_scam_insight import (
    AudioScamInsightInputError,
    AudioScamInsightNotReadyError,
    AudioScamInsightUpstreamError,
    analyze_file as analyze_audio_scam_insight_file,
)
from app.shared.core.config import settings
from app.shared.storage.upload_paths import resolved_upload_root

from .budget import apply_actual_usage_to_budget, build_context_budget, compress_messages
from .types import (
    available_capabilities_for_modalities,
    build_clarify_options,
    expand_capability_aliases,
    get_capability,
)

_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_PREVIOUS_ATTACHMENT_HINTS = (
    "这张图",
    "这个图",
    "这图片",
    "这个图片",
    "上一张图",
    "上一张图片",
    "刚才那张图",
    "刚才发的图",
    "前面的图片",
    "上面的图片",
    "这段音频",
    "刚才那段录音",
    "这个二维码",
    "刚才那个二维码",
    "上一条图片",
    "前面那张",
)
_ANTIFRAUD_INTENT_MARKERS = (
    "诈骗",
    "骗",
    "被骗",
    "风险",
    "可疑",
    "真假",
    "真伪",
    "钓鱼",
    "验证码",
    "转账",
    "汇款",
    "收款",
    "打款",
    "银行卡",
    "身份证",
    "二维码",
    "链接",
    "网址",
    "域名",
    "网图",
    "以图识图",
    "ocr",
    "公章",
    "敏感信息",
    "换脸",
    "deepfake",
    "录音鉴别",
    "音频鉴别",
    "语音分析",
    "语音深度分析",
    "过程演化",
    "阶段轨迹",
    "关键证据",
    "雷达图",
    "语音诈骗分析",
    "网址钓鱼",
    "短信检测",
    "话术检测",
)
_GENERAL_TASK_MARKERS = (
    "python",
    "代码",
    "脚本",
    "函数",
    "接口",
    "报错",
    "bug",
    "爬虫",
    "爬取",
    "网站数据",
    "前端",
    "后端",
    "sql",
    "翻译",
    "总结",
    "改写",
    "润色",
    "解释",
    "怎么写",
    "怎么做",
    "示例",
    "demo",
    "算法",
    "prompt",
    "提示词",
)
_DIRECT_CAPABILITY_HINTS = (
    "ocr",
    "网图",
    "以图识图",
    "二维码",
    "公章",
    "敏感信息",
    "换脸",
    "录音鉴别",
    "音频鉴别",
    "语音分析",
    "语音深度分析",
    "过程演化",
    "关键证据",
    "阶段轨迹",
    "雷达图",
    "网址钓鱼",
    "web_phishing",
    "text_detection",
    "ai_face",
)
_AUDIO_SCAM_INSIGHT_HINTS = (
    "语音分析",
    "语音深度分析",
    "音频分析",
    "过程演化",
    "阶段轨迹",
    "关键证据",
    "雷达图",
    "诈骗分析",
    "风险演化",
)
_AUDIO_VERIFY_HINTS = (
    "ai音频",
    "ai语音",
    "录音鉴别",
    "音频鉴别",
    "ai声音",
    "变声",
    "合成音",
    "是否ai",
    "是不是ai",
)
_IMAGE_RISK_QUERY_HINTS = (
    "诈骗",
    "骗",
    "风险",
    "可疑",
    "真假",
    "钓鱼",
    "安全吗",
    "是不是",
    "有没有问题",
    "scam",
    "fraud",
)
_PLANNER_SYSTEM_PROMPT = """你是反诈助手的任务规划器。你只负责判断这一轮应该：
1. clarify：追问用户要跑哪种检测
2. execute：直接执行一个或多个检测能力
3. chat：普通对话 / 普通助手回答，不执行检测

必须只输出 JSON，不要输出解释，不要使用 Markdown。
输出结构：
{
  "action": "clarify|execute|chat",
  "reason": "一句话",
  "use_previous_attachments": false,
  "capabilities": ["analysis"],
  "clarify_title": "要做哪一种？",
  "clarify_prompt": "可串行跑多个功能"
}

capabilities 只能从以下枚举里选：
["analysis","text_detection","ocr","official_document","pii","qr","impersonation","web_phishing","audio_scam_insight","audio_verify","ai_face"]

强规则：
- 只有当“本轮刚上传了图片/音频/文件”且用户意图不清时，才 action=clarify。
- 如果用户明确要求做反诈判断、风险判断、真假识别、二维码/网址/网图/OCR/公章/敏感信息/AI换脸/语音深度分析/音频鉴别等，才 action=execute。
- 如果只是普通助手任务，例如写 Python 代码、解释报错、总结文本、翻译、回忆上文、产品/前后端讨论，一律 action=chat。
- 不能因为历史里曾经传过材料，就对后续所有普通对话继续 action=clarify 或 action=execute。
- 只有用户明确提到之前那张图/那段音频/前面的材料时，才 use_previous_attachments=true。
- 文本里直接包含 URL 时，可以优先包含 web_phishing。
- 纯文本消息在没有明确反诈/检测意图时，不要进入 execute。
"""
_EXECUTE_REWRITE_SYSTEM_PROMPT = """你是检测结果改写器。你的输入包含“当前轮用户问题 + 当前会话上下文 + 工具结构化结果”。
你必须严格基于工具结果输出，禁止新增工具结果里没有的事实。
输出要求：
1) 先给结论（风险等级/是否可疑）；
2) 再给 2-4 条证据点，优先引用 OCR、链接、二维码、网图命中等字段；
3) 最后给一句可执行建议；
4) 不要输出“我无法判断”“已完成检测流程”等流程话术；
5) 使用中文，简洁、直接，不用 Markdown 标题。"""


def _message_attachments(message: AssistantMessage | None) -> list[dict[str, Any]]:
    if message is None:
        return []
    raw = (message.extra_payload or {}).get("attachments")
    return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []


def _current_turn_attachments(messages: list[AssistantMessage]) -> list[dict[str, Any]]:
    if not messages:
        return []
    current = messages[-1]
    if current.role != "user":
        return []
    return _message_attachments(current)


def _latest_previous_attachments(messages: list[AssistantMessage]) -> list[dict[str, Any]]:
    if not messages:
        return []
    for item in reversed(messages[:-1]):
        if item.role != "user":
            continue
        attachments = _message_attachments(item)
        if attachments:
            return attachments
    return []


def _should_reuse_previous_attachments(user_text: str) -> bool:
    collapsed = str(user_text or "").strip().replace(" ", "")
    return any(token in collapsed for token in _PREVIOUS_ATTACHMENT_HINTS)


def _attachment_modalities(attachments: list[dict[str, Any]]) -> set[str]:
    modalities: set[str] = set()
    for item in attachments:
        kind = str(item.get("upload_type") or item.get("kind") or "").strip().lower()
        if kind in {"text", "audio", "image", "video"}:
            modalities.add(kind)
    return modalities


def _has_antifraud_intent(user_text: str) -> bool:
    collapsed = str(user_text or "").strip().lower().replace(" ", "")
    if not collapsed:
        return False
    if _URL_RE.search(collapsed):
        return True
    return any(token in collapsed for token in _ANTIFRAUD_INTENT_MARKERS)


def _is_general_task_text(user_text: str) -> bool:
    collapsed = str(user_text or "").strip().lower().replace(" ", "")
    if not collapsed:
        return False
    if _has_antifraud_intent(collapsed):
        return False
    return any(token in collapsed for token in _GENERAL_TASK_MARKERS)


def _should_chain_ocr_before_analysis(
    *,
    user_text: str,
    attachments: list[dict[str, Any]],
    explicit_antifraud: bool,
) -> bool:
    if not attachments or not explicit_antifraud:
        return False
    has_image = any(
        str(item.get("upload_type") or item.get("kind") or "").strip().lower() == "image"
        for item in attachments
    )
    if not has_image:
        return False
    collapsed = str(user_text or "").strip().lower().replace(" ", "")
    if not collapsed:
        return False
    if any(token in collapsed for token in _DIRECT_CAPABILITY_HINTS):
        return False
    return any(token in collapsed for token in _IMAGE_RISK_QUERY_HINTS)


def _audio_attachment_paths(attachments: list[dict[str, Any]]) -> list[str]:
    paths: list[str] = []
    for item in attachments:
        if str(item.get("upload_type") or "").strip().lower() != "audio":
            continue
        file_path = str(item.get("file_path") or "").strip()
        if file_path:
            paths.append(file_path)
    return paths


def _recommend_audio_capabilities(user_text: str, attachments: list[dict[str, Any]]) -> list[str] | None:
    audio_paths = _audio_attachment_paths(attachments)
    if not audio_paths:
        return None
    collapsed = str(user_text or "").strip().lower().replace(" ", "")
    if not collapsed:
        return None
    if any(token in collapsed for token in _AUDIO_VERIFY_HINTS):
        return ["audio_verify"]
    if any(token in collapsed for token in _AUDIO_SCAM_INSIGHT_HINTS):
        return ["audio_scam_insight", "audio_verify"]
    if _has_antifraud_intent(user_text):
        return ["audio_scam_insight", "audio_verify"]
    return ["audio_scam_insight"]


def _resolve_saved_file(file_path: str | None) -> Path | None:
    normalized = str(file_path or "").strip()
    if not normalized:
        return None
    target = (resolved_upload_root(settings.upload_root) / normalized).resolve()
    if not target.exists():
        return None
    return target


def _read_attachment_bytes(item: dict[str, Any]) -> tuple[bytes, str, str, Path] | None:
    target = _resolve_saved_file(item.get("file_path") if isinstance(item.get("file_path"), str) else None)
    if target is None:
        return None
    try:
        data = target.read_bytes()
    except OSError:
        return None
    filename = str(item.get("name") or target.name).strip() or target.name
    kind = str(item.get("upload_type") or "").strip().lower() or "text"
    return data, filename, kind, target


def _build_file_bundles_from_attachments(
    attachments: list[dict[str, Any]],
    *,
    allowed_kinds: set[str] | None = None,
) -> dict[str, list[tuple[bytes, str]]]:
    bundles: dict[str, list[tuple[bytes, str]]] = {
        "text": [],
        "audio": [],
        "image": [],
        "video": [],
    }
    for item in attachments:
        binary = _read_attachment_bytes(item)
        if binary is None:
            continue
        data, filename, kind, _ = binary
        if kind not in bundles:
            continue
        if allowed_kinds is not None and kind not in allowed_kinds:
            continue
        bundles[kind].append((data, filename))
    return bundles


def _extract_text_from_attachments(attachments: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in attachments:
        preview_text = item.get("preview_text")
        if isinstance(preview_text, str) and preview_text.strip():
            parts.append(preview_text.strip())
            continue
        target = _resolve_saved_file(item.get("file_path") if isinstance(item.get("file_path"), str) else None)
        if target is None or target.suffix.lower() not in {".txt", ".md", ".json", ".csv", ".log", ".html", ".htm"}:
            continue
        for encoding in ("utf-8", "utf-8-sig", "gb18030"):
            try:
                text = target.read_text(encoding=encoding).strip()
                if text:
                    parts.append(text)
                break
            except UnicodeDecodeError:
                continue
            except OSError:
                break
    return "\n\n".join(parts).strip()


def _build_record_ref(
    *,
    capability_key: str,
    label: str,
    submission_id: uuid.UUID | str | None = None,
    job_id: uuid.UUID | str | None = None,
    result_id: uuid.UUID | str | None = None,
) -> dict[str, str]:
    payload = {
        "capability_key": capability_key,
        "label": label,
    }
    if submission_id is not None:
        payload["submission_id"] = str(submission_id)
    if job_id is not None:
        payload["job_id"] = str(job_id)
    if result_id is not None:
        payload["result_id"] = str(result_id)
    return payload


def _compact_json_lines(payload: dict[str, Any] | None, *, limit: int = 6) -> list[str]:
    if not isinstance(payload, dict):
        return []
    lines: list[str] = []
    for key, value in payload.items():
        if value in (None, "", [], {}):
            continue
        if isinstance(value, float):
            lines.append(f"{key}: {value:.3f}")
        else:
            lines.append(f"{key}: {value}")
        if len(lines) >= limit:
            break
    return lines


def _normalize_gallery_items(result: dict[str, Any]) -> list[dict[str, Any]]:
    raw = ((result.get("raw") or {}) if isinstance(result, dict) else {}).get("similarity_validation")
    validated = raw.get("validated_matches") if isinstance(raw, dict) else None
    candidates = validated if isinstance(validated, list) and validated else (result.get("raw") or {}).get("matches")
    if not isinstance(candidates, list):
        return []

    items: list[dict[str, Any]] = []
    for index, item in enumerate(candidates[:8]):
        if not isinstance(item, dict):
            continue
        items.append(
            {
                "id": str(item.get("id") or item.get("source_url") or f"match-{index}"),
                "title": item.get("title"),
                "source_url": item.get("source_url"),
                "image_url": item.get("image_url"),
                "thumbnail_url": item.get("thumbnail_url"),
                "domain": item.get("domain"),
                "provider": item.get("provider"),
                "is_validated": bool(item.get("is_validated")),
                "clip_similarity": item.get("clip_similarity"),
                "hash_similarity": item.get("hash_similarity"),
                "phash_distance": item.get("phash_distance"),
                "dhash_distance": item.get("dhash_distance"),
                "hash_near_duplicate": item.get("hash_near_duplicate"),
                "clip_high_similarity": item.get("clip_high_similarity"),
            }
        )
    return items


def _step_payload(
    *,
    capability_key: str,
    title: str,
    status: str,
    summary: str | None = None,
    details: list[str] | None = None,
    gallery_items: list[dict[str, Any]] | None = None,
    record_refs: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": capability_key,
        "capability_key": capability_key,
        "title": title,
        "status": status,
    }
    if summary:
        payload["summary"] = summary
    if details:
        payload["details"] = details
    if gallery_items:
        payload["gallery_items"] = gallery_items
    if record_refs:
        payload["record_refs"] = record_refs
    return payload


def _extract_first_url(*texts: str) -> str | None:
    for text in texts:
        match = _URL_RE.search(str(text or ""))
        if match:
            return match.group(0)
    return None


def _current_attachment_descriptors(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    descriptors: list[dict[str, Any]] = []
    for item in attachments[:8]:
        name = str(item.get("name") or "").strip()
        upload_type = str(item.get("upload_type") or "").strip().lower()
        preview_text = str(item.get("preview_text") or "").strip()
        descriptors.append(
            {
                "name": name,
                "upload_type": upload_type,
                "has_preview_text": bool(preview_text),
                "preview_text_length": len(preview_text),
            }
        )
    return descriptors


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        lines = [line for line in text.splitlines() if not line.strip().startswith("```")]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _strip_code_fence(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""
    if raw.startswith("```"):
        lines = [line for line in raw.splitlines() if not line.strip().startswith("```")]
        return "\n".join(lines).strip()
    return raw


def _sanitize_for_llm_context(value: Any, *, depth: int = 0) -> Any:
    if depth >= 4:
        return str(value)[:500]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        text = value.strip()
        return text[:1200] if len(text) > 1200 else text
    if isinstance(value, list):
        return [_sanitize_for_llm_context(item, depth=depth + 1) for item in value[:16]]
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for index, (k, v) in enumerate(value.items()):
            if index >= 40:
                break
            sanitized[str(k)] = _sanitize_for_llm_context(v, depth=depth + 1)
        return sanitized
    return str(value)[:1200]


def _rewrite_execute_final_text_with_llm(
    *,
    llm_call: Callable[[list[dict[str, Any]]], str],
    llm_messages_with_context: list[dict[str, Any]],
    user_text: str,
    plan_keys: list[str],
    step_results: list[dict[str, Any]],
    tool_context_blocks: list[dict[str, Any]],
) -> str | None:
    compact_steps: list[dict[str, Any]] = []
    for item in step_results[:6]:
        compact_steps.append(
            {
                "capability_key": item.get("capability_key") or item.get("id"),
                "title": item.get("title"),
                "summary": item.get("summary"),
                "details": [str(x) for x in list(item.get("details") or [])[:6]],
            }
        )
    payload = {
        "user_query": user_text,
        "executed_capabilities": plan_keys,
        "tool_results": compact_steps,
        "tool_context_blocks": tool_context_blocks[:12],
    }
    rewrite_messages = [
        *llm_messages_with_context,
        {"role": "system", "content": _EXECUTE_REWRITE_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    try:
        rewritten = _strip_code_fence(llm_call(rewrite_messages))
    except Exception:
        return None
    return rewritten or None


def _normalize_plan_result(
    payload: dict[str, Any] | None,
    *,
    current_modalities: set[str],
    available_capabilities: list[str],
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"clarify", "execute", "chat"}:
        return None
    raw_keys = payload.get("capabilities")
    capability_keys: list[str] = []
    if isinstance(raw_keys, list):
        for item in raw_keys:
            key = str(item or "").strip()
            if key and key in available_capabilities and key not in capability_keys:
                capability_keys.append(key)

    return {
        "action": action,
        "reason": str(payload.get("reason") or "").strip(),
        "use_previous_attachments": bool(payload.get("use_previous_attachments")),
        "capabilities": capability_keys,
        "clarify_title": str(payload.get("clarify_title") or "要做哪一种？").strip() or "要做哪一种？",
        "clarify_prompt": str(payload.get("clarify_prompt") or "可串行多个功能").strip() or "可串行多个功能",
        "current_modalities": list(current_modalities),
    }


def _plan_with_llm(
    *,
    llm_call: Callable[[list[dict[str, Any]]], str],
    user_text: str,
    current_attachments: list[dict[str, Any]],
    previous_attachments: list[dict[str, Any]],
    current_modalities: set[str],
    available_capabilities: list[str],
    can_reference_previous: bool,
) -> dict[str, Any] | None:
    prompt_payload = {
        "user_text": user_text,
        "has_current_attachments": bool(current_attachments),
        "current_modalities": list(current_modalities),
        "current_attachments": _current_attachment_descriptors(current_attachments),
        "has_previous_attachments": bool(previous_attachments),
        "can_reference_previous_attachments": can_reference_previous,
        "available_capabilities": available_capabilities,
        "has_url": bool(_extract_first_url(user_text, _extract_text_from_attachments(current_attachments))),
    }
    messages = [
        {"role": "system", "content": _PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
    ]
    try:
        response_text = llm_call(messages)
    except Exception:
        return None
    payload = _extract_json_object(response_text)
    return _normalize_plan_result(
        payload,
        current_modalities=current_modalities,
        available_capabilities=available_capabilities,
    )


def _fallback_plan(
    *,
    user_text: str,
    current_attachments: list[dict[str, Any]],
    previous_attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    current_modalities = _attachment_modalities(current_attachments)
    can_reference_previous = _should_reuse_previous_attachments(user_text)
    active_attachments = current_attachments or (previous_attachments if can_reference_previous else [])
    modalities = _attachment_modalities(active_attachments)
    if user_text.strip():
        modalities.add("text")

    explicit_antifraud = _has_antifraud_intent(user_text)
    general_task = _is_general_task_text(user_text)

    capability_keys = expand_capability_aliases(user_text, modalities) if (active_attachments or explicit_antifraud) else []
    if capability_keys:
        return {
            "action": "execute",
            "reason": "fallback_capability_match",
            "use_previous_attachments": bool(not current_attachments and active_attachments),
            "capabilities": capability_keys,
            "clarify_title": "要做哪一种？",
            "clarify_prompt": "可串行多个功能",
        }

    audio_capabilities = _recommend_audio_capabilities(user_text, current_attachments)
    if audio_capabilities:
        return {
            "action": "execute",
            "reason": "fallback_audio_pipeline",
            "use_previous_attachments": False,
            "capabilities": audio_capabilities,
            "clarify_title": "要做哪一种？",
            "clarify_prompt": "可串行多个功能",
        }

    if current_attachments and user_text.strip():
        capabilities = (
            ["ocr", "analysis"]
            if _should_chain_ocr_before_analysis(
                user_text=user_text,
                attachments=current_attachments,
                explicit_antifraud=explicit_antifraud,
            )
            else ["analysis"]
        )
        return {
            "action": "execute",
            "reason": "fallback_general_analysis",
            "use_previous_attachments": False,
            "capabilities": capabilities,
            "clarify_title": "要做哪一种？",
            "clarify_prompt": "可串行多个功能",
        }

    if current_attachments and current_modalities and not user_text.strip():
        return {
            "action": "clarify",
            "reason": "fallback_need_clarify",
            "use_previous_attachments": False,
            "capabilities": [],
            "clarify_title": "要做哪一种？",
            "clarify_prompt": "可串行多个功能",
        }

    if general_task and not active_attachments:
        return {
            "action": "chat",
            "reason": "fallback_general_task_chat",
            "use_previous_attachments": False,
            "capabilities": [],
            "clarify_title": "要做哪一种？",
            "clarify_prompt": "可串行跑多个功能",
        }

    return {
        "action": "chat",
        "reason": "fallback_chat",
        "use_previous_attachments": False,
        "capabilities": [],
        "clarify_title": "要做哪一种？",
        "clarify_prompt": "可串行多个功能",
    }


def _choose_plan(
    *,
    llm_call: Callable[[list[dict[str, Any]]], str],
    user_text: str,
    current_attachments: list[dict[str, Any]],
    previous_attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    current_modalities = _attachment_modalities(current_attachments)
    can_reference_previous = _should_reuse_previous_attachments(user_text)
    explicit_antifraud = _has_antifraud_intent(user_text)
    general_task = _is_general_task_text(user_text)
    audio_capabilities = _recommend_audio_capabilities(user_text, current_attachments)
    available_capabilities = available_capabilities_for_modalities(
        current_modalities | ({"text"} if user_text.strip() else set())
    )
    llm_plan = _plan_with_llm(
        llm_call=llm_call,
        user_text=user_text,
        current_attachments=current_attachments,
        previous_attachments=previous_attachments,
        current_modalities=current_modalities,
        available_capabilities=available_capabilities,
        can_reference_previous=can_reference_previous,
    )
    if llm_plan is not None:
        if not current_attachments and general_task and not explicit_antifraud:
            llm_plan["action"] = "chat"
            llm_plan["capabilities"] = []
            llm_plan["use_previous_attachments"] = False
        if llm_plan["action"] == "execute" and not llm_plan["capabilities"]:
            if audio_capabilities:
                llm_plan["capabilities"] = audio_capabilities
            elif current_attachments and user_text.strip():
                llm_plan["capabilities"] = ["analysis"]
            elif _extract_first_url(user_text):
                llm_plan["capabilities"] = ["web_phishing"]
        if llm_plan["action"] == "execute" and audio_capabilities:
            planned = list(llm_plan.get("capabilities") or [])
            if not planned or planned == ["analysis"]:
                llm_plan["capabilities"] = audio_capabilities
            elif planned == ["audio_verify"] and "audio_scam_insight" in audio_capabilities:
                llm_plan["capabilities"] = audio_capabilities
            elif planned == ["audio_scam_insight"] and "audio_verify" in audio_capabilities:
                llm_plan["capabilities"] = audio_capabilities
        if (
            llm_plan["action"] == "execute"
            and llm_plan.get("capabilities") == ["analysis"]
            and _should_chain_ocr_before_analysis(
                user_text=user_text,
                attachments=current_attachments,
                explicit_antifraud=explicit_antifraud,
            )
        ):
            llm_plan["capabilities"] = ["ocr", "analysis"]
        if llm_plan["action"] == "clarify" and audio_capabilities:
            llm_plan["action"] = "execute"
            llm_plan["capabilities"] = audio_capabilities
        if llm_plan["action"] == "clarify" and not current_attachments:
            llm_plan["action"] = "chat"
        return llm_plan
    return _fallback_plan(
        user_text=user_text,
        current_attachments=current_attachments,
        previous_attachments=previous_attachments,
    )


def _temporary_image_state(path: Path, *, with_ocr: bool = False) -> dict[str, Any]:
    state: dict[str, Any] = {
        "image_paths": [str(path)],
        "text_content": None,
    }
    if with_ocr:
        state["ocr_result"] = {
            "raw": extract_texts(image_paths=[str(path)], fallback_text=None),
        }
    return state


def _run_direct_skill_for_images(
    db: Session,
    *,
    user_id: uuid.UUID,
    attachments: list[dict[str, Any]],
    capability_key: str,
    title: str,
    kind: str,
    result_key: str,
    runner: Callable[[dict[str, Any]], dict[str, Any]],
    with_ocr: bool = False,
) -> tuple[str, list[str], list[dict[str, str]], list[dict[str, Any]], dict[str, Any]]:
    image_attachments = [item for item in attachments if str(item.get("upload_type") or "").strip().lower() == "image"]
    details: list[str] = []
    record_refs: list[dict[str, str]] = []
    gallery_items: list[dict[str, Any]] = []
    summaries: list[str] = []
    raw_items: list[dict[str, Any]] = []

    for index, item in enumerate(image_attachments, start=1):
        binary = _read_attachment_bytes(item)
        if binary is None:
            details.append(f"第 {index} 张图片读取失败")
            continue
        data, filename, _, path = binary
        payload = runner(_temporary_image_state(path, with_ocr=with_ocr))
        result = payload.get(result_key)
        if not isinstance(result, dict):
            details.append(f"{filename}: 未返回有效结果")
            continue
        refs = detection_service.persist_direct_image_skill_result(
            db,
            user_id=user_id,
            image_bytes=data,
            filename=filename,
            kind=kind,
            result_key=result_key,
            result=result,
            with_ocr=with_ocr,
        )
        record_refs.append(
            _build_record_ref(
                capability_key=capability_key,
                label=f"{title} · {filename}",
                submission_id=refs.get("submission_id"),
                job_id=refs.get("job_id"),
                result_id=refs.get("result_id"),
            )
        )
        summary = str(result.get("summary") or "").strip() or f"{filename} 已完成"
        summaries.append(summary)
        details.append(f"{filename}: {summary}")
        details.extend(_compact_json_lines(result, limit=5))
        if capability_key == "impersonation":
            gallery_items.extend(_normalize_gallery_items(result))
        raw_items.append(
            {
                "filename": filename,
                "result": _sanitize_for_llm_context(result),
            }
        )

    final_summary = summaries[0] if len(summaries) == 1 else f"共处理 {len(summaries)} 张图片"
    llm_context = {
        "capability_key": capability_key,
        "kind": kind,
        "items": raw_items,
    }
    return final_summary or "未处理到有效图片", details[:18], record_refs, gallery_items[:12], llm_context


def _run_analysis(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    user_text: str,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    bundles = _build_file_bundles_from_attachments(attachments)
    submission, job = detection_service.submit_detection(
        db,
        user_id=user_id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=settings.max_upload_bytes,
        text_content=user_text or None,
        relation_profile_id=relation_profile_id,
        file_bundles=bundles,
    )
    if job.status != "completed":
        job = detection_service.process_job(db, job.id)
    detail = detection_service.get_job_detail(db, user_id=user_id, job_id=job.id)
    result = detail.get("result") if isinstance(detail, dict) else None
    summary = "综合分析已完成"
    details: list[str] = []
    if isinstance(result, dict):
        risk_level_raw = str(result.get("risk_level") or "").strip().lower()
        risk_level_label = {
            "high": "高风险",
            "medium": "中风险",
            "low": "低风险",
            "safe": "低风险",
            "unknown": "未知风险",
        }.get(risk_level_raw, str(result.get("risk_level") or "风险待确认").strip() or "风险待确认")
        final_reason = str(result.get("final_reason") or "").strip()
        fallback_reason = str(result.get("summary") or "").strip()
        conclusion = final_reason or fallback_reason or "未提供明确结论"
        summary = f"{risk_level_label} · {conclusion}"
        details.extend(
            [
                f"风险等级: {result.get('risk_level')}",
                f"风险类型: {result.get('fraud_type') or '未命名'}",
                f"结论: {conclusion}",
            ]
        )
    llm_context = {
        "capability_key": "analysis",
        "result": _sanitize_for_llm_context(result if isinstance(result, dict) else {}),
        "job_id": str(job.id),
        "submission_id": str(submission.id),
    }
    return summary, [item for item in details if item][:12], [
        _build_record_ref(capability_key="analysis", label="综合分析", submission_id=submission.id, job_id=job.id)
    ], llm_context


def _run_text_detection(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    user_text: str,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    text_payload = "\n\n".join(part for part in [user_text.strip(), _extract_text_from_attachments(attachments)] if part).strip()
    submission, job = detection_service.submit_detection(
        db,
        user_id=user_id,
        upload_root_cfg=settings.upload_root,
        max_upload_bytes=settings.max_upload_bytes,
        text_content=text_payload or None,
        relation_profile_id=relation_profile_id,
        file_bundles=_build_file_bundles_from_attachments(attachments, allowed_kinds={"text"}),
    )
    if job.status != "completed":
        job = detection_service.process_job(db, job.id)
    detail = detection_service.get_job_detail(db, user_id=user_id, job_id=job.id)
    result = detail.get("result") if isinstance(detail, dict) else None
    summary = str((result or {}).get("summary") or "文本检测已完成")
    final_reason = str((result or {}).get("final_reason") or "").strip()
    details = [f"文本长度: {len(text_payload)}"]
    if final_reason:
        details.append(f"结论: {final_reason}")
    llm_context = {
        "capability_key": "text_detection",
        "result": _sanitize_for_llm_context(result if isinstance(result, dict) else {}),
        "text_length": len(text_payload),
        "submission_id": str(submission.id),
        "job_id": str(job.id),
    }
    return summary, details, [
        _build_record_ref(capability_key="text_detection", label="文本检测", submission_id=submission.id, job_id=job.id)
    ], llm_context


def _run_web_phishing(
    db: Session,
    *,
    user_id: uuid.UUID,
    user_text: str,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    text_blob = _extract_text_from_attachments(attachments)
    url = _extract_first_url(user_text, text_blob)
    if not url:
        raise ValueError("未找到可检测的网址")
    payload = detection_service.detect_web_phishing(url=url, html=None, return_features=True)
    refs = detection_service.persist_web_phishing_result(db, user_id=user_id, url=url, payload=payload)
    summary = str(payload.get("summary") or payload.get("risk_level") or "网址钓鱼检测已完成")
    details = [f"URL: {url}"]
    details.extend(_compact_json_lines(payload, limit=6))
    llm_context = {
        "capability_key": "web_phishing",
        "url": url,
        "result": _sanitize_for_llm_context(payload),
    }
    return summary, details, [
        _build_record_ref(
            capability_key="web_phishing",
            label="网址钓鱼检测",
            submission_id=refs.get("submission_id"),
            job_id=refs.get("job_id"),
            result_id=refs.get("result_id"),
        )
    ], llm_context


def _run_audio_verify(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    audio_paths = [
        str(item.get("file_path") or "").strip()
        for item in attachments
        if str(item.get("upload_type") or "").strip().lower() == "audio"
    ]
    if not audio_paths:
        raise ValueError("未找到可检测的音频")
    submission, job = detection_service.submit_audio_verify_from_upload_paths(
        db,
        user_id=user_id,
        relation_profile_id=relation_profile_id,
        audio_paths=audio_paths,
    )
    if job.status != "completed":
        job = detection_service.process_job(db, job.id)
    detail = detection_service.get_job_detail(db, user_id=user_id, job_id=job.id)
    result = detail.get("result") if isinstance(detail, dict) else None
    summary = str((result or {}).get("summary") or "AI 音频鉴别已完成")
    details = _compact_json_lines(result if isinstance(result, dict) else {}, limit=8)
    llm_context = {
        "capability_key": "audio_verify",
        "audio_paths": audio_paths,
        "result": _sanitize_for_llm_context(result if isinstance(result, dict) else {}),
        "submission_id": str(submission.id),
        "job_id": str(job.id),
    }
    return summary, details, [
        _build_record_ref(capability_key="audio_verify", label="AI音频鉴别", submission_id=submission.id, job_id=job.id)
    ], llm_context


def _run_audio_scam_insight(
    db: Session,
    *,
    user_id: uuid.UUID,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    audio_attachments = [item for item in attachments if str(item.get("upload_type") or "").strip().lower() == "audio"]
    if not audio_attachments:
        raise ValueError("未找到可分析的音频")

    details: list[str] = []
    record_refs: list[dict[str, str]] = []
    summary_pool: list[str] = []
    raw_items: list[dict[str, Any]] = []

    for index, item in enumerate(audio_attachments, start=1):
        audio_path = str(item.get("file_path") or "").strip()
        filename = str(item.get("name") or "").strip() or Path(audio_path).name or f"audio-{index}"
        if not audio_path:
            details.append(f"{filename}: 音频路径缺失")
            continue
        try:
            full_path = detection_service.resolve_owned_audio_upload_file(
                db,
                user_id=user_id,
                audio_path=audio_path,
            )
            payload = analyze_audio_scam_insight_file(
                str(full_path),
                filename=filename,
                language_hint="zh",
            )
            refs = detection_service.persist_audio_scam_insight_from_upload_path(
                db,
                user_id=user_id,
                audio_path=audio_path,
                filename=filename,
                insight_payload=payload,
            )
        except (AudioScamInsightInputError, AudioScamInsightNotReadyError, AudioScamInsightUpstreamError) as exc:
            details.append(f"{filename}: {exc}")
            raw_items.append({"filename": filename, "error": str(exc)})
            continue
        except Exception as exc:  # noqa: BLE001
            details.append(f"{filename}: {exc}")
            raw_items.append({"filename": filename, "error": str(exc)})
            continue

        decision = payload.get("decision") if isinstance(payload.get("decision"), dict) else {}
        dynamics = payload.get("dynamics") if isinstance(payload.get("dynamics"), dict) else {}
        evidence_segments = [entry for entry in list(payload.get("evidence_segments") or []) if isinstance(entry, dict)]

        summary = str(decision.get("summary") or "").strip() or "语音深度分析已完成"
        summary_pool.append(summary)

        risk_level_raw = str(decision.get("risk_level") or "").strip().lower()
        risk_level = {
            "high": "高风险",
            "medium": "中风险",
            "low": "低风险",
        }.get(risk_level_raw, risk_level_raw or "未知")
        risk_score = decision.get("call_risk_score")
        confidence = decision.get("confidence")
        risk_score_text = f"{float(risk_score):.3f}" if isinstance(risk_score, (int, float)) else "-"
        confidence_text = f"{float(confidence):.3f}" if isinstance(confidence, (int, float)) else "-"
        details.append(f"{filename}: {risk_level} / 风险分={risk_score_text} / 置信度={confidence_text}")

        stage_labels = [
            str(stage.get("label") or stage.get("stage") or "").strip()
            for stage in list(dynamics.get("stage_sequence") or [])
            if isinstance(stage, dict) and str(stage.get("label") or stage.get("stage") or "").strip()
        ]
        if stage_labels:
            details.append(f"{filename}: 阶段轨迹={' → '.join(stage_labels[:6])}")

        key_moment_items: list[str] = []
        for moment in list(dynamics.get("key_moments") or []):
            if not isinstance(moment, dict):
                continue
            label = str(moment.get("label") or "").strip()
            if not label:
                continue
            time_sec = moment.get("time_sec")
            if isinstance(time_sec, (int, float)):
                key_moment_items.append(f"{label}@{float(time_sec):.1f}s")
            else:
                key_moment_items.append(label)
            if len(key_moment_items) >= 4:
                break
        if key_moment_items:
            details.append(f"{filename}: 关键时刻={'；'.join(key_moment_items)}")

        if evidence_segments:
            evidence = evidence_segments[0]
            stage_label = str(evidence.get("stage_label") or "").strip()
            explanation = str(evidence.get("explanation") or "").strip()
            transcript = str(evidence.get("transcript_excerpt") or "").strip()
            evidence_parts = [part for part in [stage_label, explanation, transcript] if part]
            if evidence_parts:
                details.append(f"{filename}: 关键证据={' | '.join(evidence_parts)}")

        record_refs.append(
            _build_record_ref(
                capability_key="audio_scam_insight",
                label=f"语音深度分析 · {filename}",
                submission_id=refs.get("submission_id"),
                job_id=refs.get("job_id"),
                result_id=refs.get("result_id"),
            )
        )
        raw_items.append(
            {
                "filename": filename,
                "result": _sanitize_for_llm_context(payload),
                "submission_id": str(refs.get("submission_id") or ""),
                "job_id": str(refs.get("job_id") or ""),
                "result_id": str(refs.get("result_id") or ""),
            }
        )

    success_count = len(summary_pool)
    if success_count <= 0:
        raise ValueError(details[0] if details else "语音深度分析失败")

    final_summary = summary_pool[0] if success_count == 1 else f"共完成 {success_count} 段音频的语音深度分析"
    llm_context = {
        "capability_key": "audio_scam_insight",
        "items": raw_items,
        "success_count": success_count,
    }
    return final_summary, details[:24], record_refs, llm_context


def _run_ai_face(
    db: Session,
    *,
    user_id: uuid.UUID,
    attachments: list[dict[str, Any]],
) -> tuple[str, list[str], list[dict[str, str]], dict[str, Any]]:
    image_attachments = [item for item in attachments if str(item.get("upload_type") or "").strip().lower() == "image"]
    details: list[str] = []
    record_refs: list[dict[str, str]] = []
    hits = 0
    raw_items: list[dict[str, Any]] = []
    for item in image_attachments:
        binary = _read_attachment_bytes(item)
        if binary is None:
            continue
        data, filename, _, _ = binary
        payload = ai_face_service.detect_ai_face_and_store(
            db,
            user_id=user_id,
            image_bytes=data,
            filename=filename,
            content_type=str(item.get("mime_type") or "").strip() or None,
        )
        hits += 1
        details.append(f"{filename}: {payload.get('prediction')} / {payload.get('fake_probability')}")
        raw_items.append(
            {
                "filename": filename,
                "result": _sanitize_for_llm_context(payload),
            }
        )
        record_refs.append(
            _build_record_ref(
                capability_key="ai_face",
                label=f"AI换脸检测 · {filename}",
                submission_id=payload.get("submission_id"),
                job_id=payload.get("job_id"),
                result_id=payload.get("result_id"),
            )
        )
    llm_context = {
        "capability_key": "ai_face",
        "items": raw_items,
    }
    return (f"共完成 {hits} 张图片的 AI 换脸检测" if hits else "未处理到有效图片"), details[:12], record_refs, llm_context


def _run_capability(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    user_text: str,
    attachments: list[dict[str, Any]],
    capability_key: str,
) -> tuple[str, list[str], list[dict[str, str]], list[dict[str, Any]], dict[str, Any]]:
    if capability_key == "analysis":
        summary, details, record_refs, llm_context = _run_analysis(
            db,
            user_id=user_id,
            relation_profile_id=relation_profile_id,
            user_text=user_text,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    if capability_key == "text_detection":
        summary, details, record_refs, llm_context = _run_text_detection(
            db,
            user_id=user_id,
            relation_profile_id=relation_profile_id,
            user_text=user_text,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    if capability_key == "ocr":
        return _run_direct_skill_for_images(
            db,
            user_id=user_id,
            attachments=attachments,
            capability_key="ocr",
            title="OCR话术识别",
            kind="ocr-phishing",
            result_key="ocr_result",
            runner=run_ocr_phishing,
        )
    if capability_key == "official_document":
        return _run_direct_skill_for_images(
            db,
            user_id=user_id,
            attachments=attachments,
            capability_key="official_document",
            title="公章仿造",
            kind="official-document",
            result_key="official_document_result",
            runner=run_official_document_checker,
            with_ocr=True,
        )
    if capability_key == "pii":
        return _run_direct_skill_for_images(
            db,
            user_id=user_id,
            attachments=attachments,
            capability_key="pii",
            title="敏感信息检测",
            kind="pii",
            result_key="pii_result",
            runner=run_pii_guard,
            with_ocr=True,
        )
    if capability_key == "qr":
        return _run_direct_skill_for_images(
            db,
            user_id=user_id,
            attachments=attachments,
            capability_key="qr",
            title="二维码URL检测",
            kind="qr",
            result_key="qr_result",
            runner=run_qr_inspector,
        )
    if capability_key == "impersonation":
        return _run_direct_skill_for_images(
            db,
            user_id=user_id,
            attachments=attachments,
            capability_key="impersonation",
            title="网图识别",
            kind="impersonation",
            result_key="impersonation_result",
            runner=run_impersonation_checker,
        )
    if capability_key == "web_phishing":
        summary, details, record_refs, llm_context = _run_web_phishing(
            db,
            user_id=user_id,
            user_text=user_text,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    if capability_key == "audio_verify":
        summary, details, record_refs, llm_context = _run_audio_verify(
            db,
            user_id=user_id,
            relation_profile_id=relation_profile_id,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    if capability_key == "audio_scam_insight":
        summary, details, record_refs, llm_context = _run_audio_scam_insight(
            db,
            user_id=user_id,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    if capability_key == "ai_face":
        summary, details, record_refs, llm_context = _run_ai_face(
            db,
            user_id=user_id,
            attachments=attachments,
        )
        return summary, details, record_refs, [], llm_context
    raise ValueError(f"Unsupported capability: {capability_key}")


def _build_final_text(plan_keys: list[str], step_results: list[dict[str, Any]]) -> str:
    if not step_results:
        return "已完成。"
    if len(plan_keys) == 1:
        summary = str(step_results[0].get("summary") or "").strip()
        if summary:
            return summary
    lines: list[str] = []
    if len(plan_keys) == 1:
        lines.append(f"已完成 {step_results[0].get('title') or '检测'}。")
    else:
        lines.append(f"已串行完成 {len(plan_keys)} 项。")
    for item in step_results[:6]:
        title = str(item.get("title") or "").strip() or "检测"
        summary = str(item.get("summary") or "").strip() or "已完成"
        lines.append(f"• {title}：{summary}")
    return "\n".join(lines)


def iter_assistant_agent_stream(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
    user_text: str,
    messages: list[AssistantMessage],
    assistant_message_id: uuid.UUID,
    prepare_llm_request: Callable[..., tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], str | None]],
    llm_call: Callable[[list[dict[str, Any]]], str],
    llm_stream: Callable[[list[dict[str, Any]]], Iterator[dict[str, Any]]],
    llm_fallback: Callable[[str, dict[str, Any], str | None], str],
) -> Iterator[dict[str, Any]]:
    current_attachments = _current_turn_attachments(messages)
    previous_attachments = _latest_previous_attachments(messages)
    plan = _choose_plan(
        llm_call=llm_call,
        user_text=user_text,
        current_attachments=current_attachments,
        previous_attachments=previous_attachments,
    )

    active_attachments = current_attachments
    if not active_attachments and plan.get("use_previous_attachments"):
        active_attachments = previous_attachments

    budget = build_context_budget(messages, pending_text=user_text)
    yield {
        "event": "context_budget",
        "payload": {
            "assistant_message_id": str(assistant_message_id),
            "budget": budget,
        },
    }

    requested_keys = [key for key in list(plan.get("capabilities") or []) if get_capability(key) is not None]
    if plan.get("action") == "clarify":
        clarify_modalities = _attachment_modalities(current_attachments)
        clarify = {
            "title": str(plan.get("clarify_title") or "要做哪一种？"),
            "prompt": str(plan.get("clarify_prompt") or "可串行多个功能"),
            "options": build_clarify_options(clarify_modalities),
        }
        yield {
            "event": "clarify",
            "payload": {
                "assistant_message_id": str(assistant_message_id),
                "clarify": clarify,
            },
        }
        yield {
            "event": "final",
            "content": "要做网图 / OCR / 二维码哪一种？可串行。",
            "extra_payload": {
                "assistant_agent": {
                    "mode": "clarify",
                    "planner": {
                        "action": "clarify",
                        "reason": plan.get("reason"),
                        "use_previous_attachments": False,
                    },
                    "clarify": clarify,
                    "plan": [],
                    "steps": [],
                },
                "context_budget": budget,
                "compression": None,
            },
        }
        return

    if plan.get("action") == "execute" and requested_keys:
        plan_items = []
        for key in requested_keys:
            spec = get_capability(key)
            if spec is None:
                continue
            plan_items.append({"key": key, "label": spec.label, "status": "pending"})

        yield {
            "event": "plan",
            "payload": {
                "assistant_message_id": str(assistant_message_id),
                "items": plan_items,
            },
        }

        step_results: list[dict[str, Any]] = []
        record_refs: list[dict[str, str]] = []
        tool_context_blocks: list[dict[str, Any]] = []
        for key in requested_keys:
            spec = get_capability(key)
            if spec is None:
                continue
            yield {
                "event": "step_start",
                "payload": {
                    "assistant_message_id": str(assistant_message_id),
                    "step": _step_payload(capability_key=key, title=spec.label, status="running", summary="执行中"),
                },
            }
            try:
                summary, details, step_refs, gallery_items, llm_context = _run_capability(
                    db,
                    user_id=user_id,
                    relation_profile_id=relation_profile_id,
                    user_text=user_text,
                    attachments=active_attachments,
                    capability_key=key,
                )
                tool_context_blocks.append(
                    {
                        "capability_key": key,
                        "title": spec.label,
                        "context": _sanitize_for_llm_context(llm_context),
                    }
                )
                step = _step_payload(
                    capability_key=key,
                    title=spec.label,
                    status="completed",
                    summary=summary,
                    details=details,
                    gallery_items=gallery_items,
                    record_refs=step_refs,
                )
                step_results.append(step)
                record_refs.extend(step_refs)
                yield {
                    "event": "step_done",
                    "payload": {
                        "assistant_message_id": str(assistant_message_id),
                        "step": step,
                    },
                }
            except Exception as exc:  # noqa: BLE001
                step = _step_payload(
                    capability_key=key,
                    title=spec.label,
                    status="failed",
                    summary="执行失败",
                    details=[str(exc)],
                )
                step_results.append(step)
                yield {
                    "event": "step_error",
                    "payload": {
                        "assistant_message_id": str(assistant_message_id),
                        "step": step,
                    },
                }

        final_plan_items = []
        status_map = {
            str(item.get("capability_key") or item.get("id") or ""): str(item.get("status") or "pending")
            for item in step_results
        }
        for item in plan_items:
            final_plan_items.append(
                {
                    **item,
                    "status": status_map.get(str(item.get("key") or ""), str(item.get("status") or "pending")),
                }
            )

        tool_final_text = _build_final_text(requested_keys, step_results)
        prompt_messages_source, compressed_summary, compression = compress_messages(
            messages,
            usage_ratio=float(budget.get("usage_ratio") or 0.0),
        )
        llm_messages, _, _, _ = prepare_llm_request(
            db,
            messages=messages,
            prompt_history_messages=prompt_messages_source,
            compressed_summary=compressed_summary,
            user_text=user_text,
            relation_profile_id=relation_profile_id,
        )
        rewritten_final_text = _rewrite_execute_final_text_with_llm(
            llm_call=llm_call,
            llm_messages_with_context=llm_messages,
            user_text=user_text,
            plan_keys=requested_keys,
            step_results=step_results,
            tool_context_blocks=tool_context_blocks,
        )
        final_budget = apply_actual_usage_to_budget(budget, None, compressed=bool(compression))
        yield {
            "event": "final",
            "content": rewritten_final_text or tool_final_text,
            "extra_payload": {
                "assistant_agent": {
                    "mode": "tool",
                    "planner": {
                        "action": "execute",
                        "reason": plan.get("reason"),
                        "use_previous_attachments": bool(plan.get("use_previous_attachments")),
                    },
                    "plan": final_plan_items,
                    "steps": step_results,
                    "record_refs": record_refs,
                },
                "context_budget": final_budget,
                "compression": compression,
            },
        }
        return

    prompt_messages_source, compressed_summary, compression = compress_messages(
        messages,
        usage_ratio=float(budget.get("usage_ratio") or 0.0),
    )
    llm_messages, extra_payload, retrieval_summary, relation_name = prepare_llm_request(
        db,
        messages=messages,
        prompt_history_messages=prompt_messages_source,
        compressed_summary=compressed_summary,
        user_text=user_text,
        relation_profile_id=relation_profile_id,
    )
    yield {
        "event": "step_start",
        "payload": {
            "assistant_message_id": str(assistant_message_id),
            "step": _step_payload(capability_key="answer", title="生成答复", status="running", summary="执行中"),
        },
    }
    usage: dict[str, Any] | None = None
    parts: list[str] = []
    final_budget = apply_actual_usage_to_budget(budget, None, compressed=bool(compression))
    try:
        for item in llm_stream(llm_messages):
            if item.get("type") == "delta":
                delta = str(item.get("text") or "")
                if not delta:
                    continue
                parts.append(delta)
                yield {
                    "event": "delta",
                    "text": delta,
                    "phase": item.get("phase") or "answer",
                }
            elif item.get("type") == "usage" and isinstance(item.get("usage"), dict):
                usage = item.get("usage")
                final_budget = apply_actual_usage_to_budget(budget, usage, compressed=bool(compression))
                yield {
                    "event": "context_budget",
                    "payload": {
                        "assistant_message_id": str(assistant_message_id),
                        "budget": final_budget,
                    },
                }
    except Exception:
        fallback = llm_fallback(user_text, retrieval_summary, relation_name)
        if fallback:
            parts.append(fallback)
            yield {
                "event": "delta",
                "text": fallback,
                "phase": "answer",
            }

    final_text = "".join(parts).strip()
    step = _step_payload(
        capability_key="answer",
        title="生成答复",
        status="completed",
        summary="已完成",
        details=[f"输出长度: {len(final_text)}"] + _compact_json_lines(usage, limit=4),
    )
    yield {
        "event": "step_done",
        "payload": {
            "assistant_message_id": str(assistant_message_id),
            "step": step,
        },
    }
    yield {
        "event": "final",
        "content": final_text,
        "extra_payload": {
            **extra_payload,
            "usage": usage or {},
            "assistant_agent": {
                "mode": "chat",
                "planner": {
                    "action": "chat",
                    "reason": plan.get("reason"),
                    "use_previous_attachments": False,
                },
                "plan": [{"key": "answer", "label": "生成答复", "status": "completed"}],
                "steps": [step],
            },
            "context_budget": final_budget,
            "compression": compression,
        },
    }
