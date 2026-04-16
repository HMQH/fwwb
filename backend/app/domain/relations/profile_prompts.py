"""关系对象 AI 画像提示词。"""
from __future__ import annotations

import json
from typing import Any

_RELATION_PROFILE_SCHEMA = {
    "should_update": True,
    "profile_summary": "不超过 220 字的中文对象画像摘要",
    "stable_traits": ["稳定身份/关系特征"],
    "communication_style": ["沟通风格或常见互动方式"],
    "risk_signals": ["稳定风险信号"],
    "trusted_signals": ["可作为核验依据的稳定信号"],
    "caution_points": ["需要额外核验的点"],
    "query_tags": ["关系对象", "场景", "风险类型"],
    "confidence": 0.72,
    "update_reason": "为什么这次应更新或保持原画像",
}


def _json_dump(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_relation_profile_prompts(
    *,
    trigger: str,
    base_profile: dict[str, Any],
    existing_summary: str | None,
    prior_summary_snapshots: list[dict[str, Any]],
    recent_memories: list[dict[str, Any]],
    upload_overview: dict[str, Any],
    detection_briefs: list[dict[str, Any]],
) -> tuple[str, str]:
    system_prompt = (
        "你是反诈系统里的“关系对象长期画像整理器”。\n"
        "任务：根据对象基础资料、历史记忆、上传素材概况、检测结论，提炼可跨会话复用的稳定对象画像。\n"
        "规则：\n"
        "1. 只保留稳定、可复用、能帮助后续核验身份或理解风险的特征；不要输出流水账。\n"
        "2. 没有证据就不要臆测；不因为一次性事件就下结论。\n"
        "3. profile_summary 必须是给系统内部使用的摘要，不要写成对用户说的话。\n"
        "4. 若现有材料不足以形成更稳定画像，可 should_update=false，并让 profile_summary 保持空字符串。\n"
        "5. risk_signals / trusted_signals / caution_points 都应基于证据，允许为空数组。\n"
        "6. 只输出 JSON。"
    )
    user_prompt = f"""
请完成“关系对象长期画像评估”，只输出 JSON。

【触发原因】
{trigger}

【输出 JSON schema】
{_json_dump(_RELATION_PROFILE_SCHEMA)}

【对象基础资料】
{_json_dump(base_profile)}

【已有对象画像摘要】
{existing_summary or "暂无"}

【历史画像快照】
{_json_dump(prior_summary_snapshots)}

【近期对象记忆】
{_json_dump(recent_memories)}

【对象关联素材概况】
{_json_dump(upload_overview)}

【关联检测结论摘要】
{_json_dump(detection_briefs)}
""".strip()
    return system_prompt, user_prompt
