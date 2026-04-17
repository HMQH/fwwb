from __future__ import annotations

import base64
import json
import mimetypes
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from app.domain.agent.state import AgentState
from app.shared.core.config import settings
from app.shared.observability.langsmith import traceable

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
_CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_BARE_ARRAY_FIELD_RE = re.compile(
    r'"(?P<field>observations|suspected_risks)"\s*:\s*\[(?P<body>.*?)\]',
    re.DOTALL,
)

_IMAGE_TOOL_ORDER = [
    "qr_inspector",
    "ocr_phishing",
    "official_document_checker",
    "pii_guard",
    "impersonation_checker",
]
_ALLOWED_RECOMMENDED_TOOLS = set(_IMAGE_TOOL_ORDER)

_TOOL_CATALOG = {
    "qr_inspector": "识别二维码内容、支付码、跳转链接和可疑扫码风险。",
    "ocr_phishing": "提取图片文字并识别诈骗话术、诱导下载、转账催促、威胁恐吓等语言风险。",
    "official_document_checker": "识别疑似法院传票、政府通知、公文、公章/正式文书伪造线索。",
    "pii_guard": "识别身份证号、银行卡号、手机号、验证码等敏感信息泄露。",
    "impersonation_checker": "通过以图搜图和相似图分析识别网图、盗图、冒充头像等风险。",
    "text_rag_skill": "对 OCR 提取出的文本做更深的诈骗语义分析；仅在有足够文本时再触发。",
}


def _strip_code_fences(raw_content: str) -> str:
    text = raw_content.strip()
    if text.startswith("```"):
        text = _CODE_FENCE_RE.sub("", text).strip()
    return text


def _repair_bare_string_array_items(text: str) -> str:
    def _replace(match: re.Match[str]) -> str:
        body = match.group("body")
        if '"' in body:
            return match.group(0)

        lines = [line.strip().rstrip(",") for line in body.splitlines()]
        items = [line for line in lines if line]
        if not items:
            return f'"{match.group("field")}": []'

        repaired = ", ".join(json.dumps(item, ensure_ascii=False) for item in items)
        return f'"{match.group("field")}": [{repaired}]'

    return _BARE_ARRAY_FIELD_RE.sub(_replace, text)


def _extract_json_text(raw_content: str) -> str:
    text = _strip_code_fences(raw_content)
    match = _JSON_BLOCK_RE.search(text)
    if match is not None:
        return match.group(0).strip()
    return text


def _extract_json_payload(raw_content: str) -> dict[str, Any]:
    text = _extract_json_text(raw_content)
    if not text:
        raise RuntimeError("VLM returned empty content")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        repaired_text = _repair_bare_string_array_items(text)
        payload = json.loads(repaired_text)

    if not isinstance(payload, dict):
        raise RuntimeError("VLM JSON content must be an object")
    return payload


def _api_url() -> str:
    base_url = settings.dashscope_base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def _api_key() -> str:
    key = (settings.dashscope_api_key or settings.detection_llm_api_key or "").strip()
    if not key:
        raise RuntimeError("DASHSCOPE_API_KEY is required for the vision planner")
    return key


def _mime_type(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "image/png"


def _image_to_data_url(path: str) -> str:
    image_path = Path(path)
    raw = image_path.read_bytes()
    mime = _mime_type(path)
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _default_plan(*, has_text: bool, has_images: bool, has_audio: bool, has_video: bool) -> dict[str, Any]:
    recommended_tools = list(_IMAGE_TOOL_ORDER) if has_images else []
    return {
        "status": "fallback",
        "image_type": "unknown_image" if has_images else "no_image",
        "observations": ["未能调用视觉规划模型，已退回到默认图像工具路由。"] if has_images else [],
        "suspected_risks": [],
        "recommended_tools": recommended_tools,
        "priority_order": recommended_tools,
        "ocr_text_expected": bool(has_images),
        "should_run_text_rag_after_ocr": bool(has_text or has_images),
        "summary": "默认启用二维码、OCR、公文、敏感信息和搜图检测。",
        "reasoning": "视觉规划失败，使用保守的首轮图像检测计划。",
        "unsupported_modalities": [name for name, enabled in (("audio", has_audio), ("video", has_video)) if enabled],
    }


def _normalize_tool_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in value:
        tool = str(item or "").strip()
        if tool not in _ALLOWED_RECOMMENDED_TOOLS or tool in seen:
            continue
        seen.add(tool)
        result.append(tool)
    return result


def _normalize_string_list(value: Any, *, limit: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _normalize_plan(payload: dict[str, Any], *, fallback: dict[str, Any]) -> dict[str, Any]:
    recommended = _normalize_tool_names(payload.get("recommended_tools"))
    priority = _normalize_tool_names(payload.get("priority_order"))
    if not priority:
        priority = recommended
    for item in recommended:
        if item not in priority:
            priority.append(item)
    if not recommended:
        recommended = list(fallback.get("recommended_tools") or [])
    if not priority:
        priority = list(recommended)

    return {
        "status": "completed",
        "image_type": str(payload.get("image_type") or fallback.get("image_type") or "unknown_image").strip(),
        "observations": _normalize_string_list(payload.get("observations")),
        "suspected_risks": _normalize_string_list(payload.get("suspected_risks")),
        "recommended_tools": recommended,
        "priority_order": priority,
        "ocr_text_expected": bool(payload.get("ocr_text_expected", fallback.get("ocr_text_expected", True))),
        "should_run_text_rag_after_ocr": bool(
            payload.get("should_run_text_rag_after_ocr", fallback.get("should_run_text_rag_after_ocr", True))
        ),
        "summary": str(payload.get("summary") or fallback.get("summary") or "").strip(),
        "reasoning": str(payload.get("reasoning") or fallback.get("reasoning") or "").strip(),
        "unsupported_modalities": list(fallback.get("unsupported_modalities") or []),
    }


def _build_messages(image_paths: list[str], text_content: str | None) -> list[dict[str, Any]]:
    clipped_images = image_paths[: max(1, int(settings.vision_planner_max_images))]
    context_text = (text_content or "").strip()[:500] or "无"
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "你是一个反诈多模态图片分析规划器。\n"
                "你的任务不是直接下最终结论，而是根据图片内容判断应该启用哪些检测工具。\n\n"
                "可用工具：\n"
                + "\n".join(f"- {name}: {desc}" for name, desc in _TOOL_CATALOG.items())
                + "\n\n输出要求（必须严格遵守）：\n"
                "1. 只输出一个 JSON 对象，不允许输出 markdown 代码块，不允许输出任何前后解释。\n"
                "2. JSON 必须包含字段：image_type, observations, suspected_risks, recommended_tools, "
                "priority_order, ocr_text_expected, should_run_text_rag_after_ocr, summary, reasoning。\n"
                "3. observations 必须是字符串数组，例如 [\"观察1\", \"观察2\"]。\n"
                "4. suspected_risks 必须是字符串数组，例如 [\"风险1\", \"风险2\"]。\n"
                "5. 上述两个数组中的每个元素都必须用双引号包裹，不能出现未加引号的中文句子。\n"
                "6. recommended_tools 和 priority_order 只能从 "
                "qr_inspector / ocr_phishing / official_document_checker / pii_guard / impersonation_checker 中选择。\n"
                "7. 不要把 text_rag_skill 放进 recommended_tools；它只应在 OCR 提取出足够文本后再触发。\n"
                "8. 如果图片明显包含大段文字、公文、聊天记录、海报文案，则 should_run_text_rag_after_ocr 设为 true。\n"
                "9. 布尔值必须写 true 或 false，不要写成字符串。\n\n"
                f"补充文本上下文（如果有）：{context_text}"
            ),
        }
    ]
    for path in clipped_images:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": _image_to_data_url(path)},
            }
        )
    return [
        {
            "role": "system",
            "content": (
                "你只负责为反诈图片检测任务规划工具调用顺序。"
                "输出必须是严格合法的 JSON 对象，不能包含 markdown 代码块。"
            ),
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]


def _call_vlm(image_paths: list[str], text_content: str | None) -> str:
    payload = {
        "model": settings.vlm_model,
        "messages": _build_messages(image_paths, text_content),
        "temperature": 0.1,
        "max_tokens": 900,
        "stream": False,
    }
    request = urllib.request.Request(
        _api_url(),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.agent_timeout_seconds) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Vision planner request failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Vision planner request failed: {exc.reason}") from exc

    data = json.loads(body)
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("Vision planner response did not include choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        raw_content = "".join(item.get("text", "") if isinstance(item, dict) else str(item) for item in content)
    else:
        raw_content = str(content or "")
    return raw_content


@traceable(name="agent.vision_planner", run_type="chain")
def run_vision_planner(state: AgentState) -> dict[str, Any]:
    image_paths = list(state.get("image_paths") or [])
    has_text = bool(str(state.get("text_content") or "").strip())
    has_audio = bool(state.get("audio_paths"))
    has_video = bool(state.get("video_paths"))
    fallback = _default_plan(
        has_text=has_text,
        has_images=bool(image_paths),
        has_audio=has_audio,
        has_video=has_video,
    )
    if not image_paths:
        return fallback

    raw_response = ""
    try:
        raw_response = _call_vlm(image_paths, state.get("text_content"))
        payload = _extract_json_payload(raw_response)
        plan = _normalize_plan(payload, fallback=fallback)
    except Exception as exc:  # noqa: BLE001
        plan = dict(fallback)
        plan["error"] = f"{type(exc).__name__}: {exc}"
    if raw_response:
        plan["raw_response"] = raw_response
    plan["tool_catalog"] = dict(_TOOL_CATALOG)
    return plan
