from __future__ import annotations

from typing import Any

from app.domain.assistant.entity import AssistantMessage

SAFE_CONTEXT_LIMIT = 64_000


def _estimate_tokens(text: str | None) -> int:
    value = str(text or "").strip()
    if not value:
        return 0
    return max(1, len(value) // 3 + 1)


def _message_budget_cost(message: AssistantMessage) -> int:
    total = _estimate_tokens(message.content)
    extra_payload = message.extra_payload or {}
    attachments = extra_payload.get("attachments")
    if isinstance(attachments, list):
        for item in attachments:
            if not isinstance(item, dict):
                continue
            total += _estimate_tokens(item.get("name"))
            total += _estimate_tokens(item.get("preview_text"))
    return total + 18


def _pressure_level(usage_ratio: float) -> str:
    if usage_ratio >= 0.92:
        return "overflow"
    if usage_ratio >= 0.85:
        return "critical"
    if usage_ratio >= 0.75:
        return "high"
    if usage_ratio >= 0.60:
        return "watch"
    return "low"


def _normalize_usage_tokens(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return max(0, int(float(text)))
        except ValueError:
            return None
    return None


def latest_compression_summary(messages: list[AssistantMessage]) -> str | None:
    for message in reversed(messages):
        extra_payload = message.extra_payload or {}
        compression = extra_payload.get("compression")
        if isinstance(compression, dict):
            summary = compression.get("summary")
            if isinstance(summary, str) and summary.strip():
                return summary.strip()
        assistant_agent = extra_payload.get("assistant_agent")
        if isinstance(assistant_agent, dict):
            compression = assistant_agent.get("compression")
            if isinstance(compression, dict):
                summary = compression.get("summary")
                if isinstance(summary, str) and summary.strip():
                    return summary.strip()
    return None


def build_context_budget(
    messages: list[AssistantMessage],
    *,
    pending_text: str = "",
) -> dict[str, Any]:
    used_tokens = sum(_message_budget_cost(message) for message in messages) + _estimate_tokens(pending_text)
    remaining_tokens = max(0, SAFE_CONTEXT_LIMIT - used_tokens)
    usage_ratio = min(1.0, used_tokens / SAFE_CONTEXT_LIMIT if SAFE_CONTEXT_LIMIT else 0.0)
    return {
        "max_tokens": SAFE_CONTEXT_LIMIT,
        "used_tokens": used_tokens,
        "remaining_tokens": remaining_tokens,
        "usage_ratio": round(usage_ratio, 4),
        "pressure_level": _pressure_level(usage_ratio),
        "message_count": len(messages),
        "compressed": False,
        "usage_source": "estimate",
        "actual_prompt_tokens": None,
        "actual_completion_tokens": None,
        "actual_total_tokens": None,
    }


def apply_actual_usage_to_budget(
    budget: dict[str, Any],
    usage: dict[str, Any] | None,
    *,
    compressed: bool | None = None,
) -> dict[str, Any]:
    next_budget = dict(budget)
    if compressed is not None:
        next_budget["compressed"] = compressed

    prompt_tokens = _normalize_usage_tokens((usage or {}).get("prompt_tokens"))
    completion_tokens = _normalize_usage_tokens((usage or {}).get("completion_tokens"))
    total_tokens = _normalize_usage_tokens((usage or {}).get("total_tokens"))

    next_budget["actual_prompt_tokens"] = prompt_tokens
    next_budget["actual_completion_tokens"] = completion_tokens
    next_budget["actual_total_tokens"] = total_tokens

    if prompt_tokens is None:
        next_budget["usage_source"] = "estimate"
        return next_budget

    remaining_tokens = max(0, SAFE_CONTEXT_LIMIT - prompt_tokens)
    usage_ratio = min(1.0, prompt_tokens / SAFE_CONTEXT_LIMIT if SAFE_CONTEXT_LIMIT else 0.0)
    next_budget.update(
        {
            "used_tokens": prompt_tokens,
            "remaining_tokens": remaining_tokens,
            "usage_ratio": round(usage_ratio, 4),
            "pressure_level": _pressure_level(usage_ratio),
            "usage_source": "prompt_tokens",
        }
    )
    return next_budget


def compress_messages(
    messages: list[AssistantMessage],
    *,
    usage_ratio: float,
) -> tuple[list[AssistantMessage], str | None, dict[str, Any] | None]:
    if len(messages) <= 8 and usage_ratio < 0.75:
        return messages, latest_compression_summary(messages), None

    keep_recent = 4 if usage_ratio >= 0.85 else 6
    if len(messages) <= keep_recent:
        return messages, latest_compression_summary(messages), None

    older = messages[:-keep_recent]
    recent = messages[-keep_recent:]
    previous_summary = latest_compression_summary(messages)
    summary_lines: list[str] = []
    if previous_summary:
        summary_lines.append(previous_summary)

    for item in older[-12:]:
        role = "用户" if item.role == "user" else "助手"
        content = " ".join(str(item.content or "").split())
        if len(content) > 120:
            content = f"{content[:120]}…"
        attachments = (item.extra_payload or {}).get("attachments")
        attachment_hint = ""
        if isinstance(attachments, list) and attachments:
            names = [
                str(entry.get("name") or "").strip()
                for entry in attachments
                if isinstance(entry, dict) and str(entry.get("name") or "").strip()
            ]
            if names:
                attachment_hint = f" 附件：{', '.join(names[:3])}"
        summary_lines.append(f"{role}：{content or '无文本'}{attachment_hint}")

    summary = "\n".join(summary_lines).strip() or None
    compression = {
        "applied": bool(summary),
        "kept_recent": keep_recent,
        "summarized_messages": len(older),
        "summary": summary,
    }
    return recent, summary, compression
