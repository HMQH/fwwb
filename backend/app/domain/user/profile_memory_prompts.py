"""用户画像 MEMORY 提示词。"""
from __future__ import annotations

import json
from typing import Any

from app.shared.core.config import settings

_MEMORY_BUCKETS = [
    "risk_pattern",
    "communication_style",
    "preference",
    "protection",
    "relationship",
    "stability_signal",
]

_ASSESS_SCHEMA = {
    "should_promote": False,
    "urgency_delta": 0,
    "event_title": "一句话标题，12~24字",
    "candidate_memory": "适合写入长期 MEMORY.md 的中文摘要；若不该晋升则留空字符串",
    "memory_bucket": "risk_pattern",
    "query_tags": ["诈骗类型", "沟通方式", "关系对象"],
    "safety_score": 95,
    "promotion_reason": "为什么应或不应晋升",
    "salience_score": 0.72,
}

_MERGE_SCHEMA = {
    "profile_summary": "不超过 220 字的中文长期画像摘要",
    "merge_reason": "本次合并后画像变化说明",
}


def _json_dump(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _base_assess_system_prompt(source_label: str) -> str:
    return (
        "你是反诈系统里的长期记忆评估器，负责决定哪些内容应该从短期事件晋升为长期用户画像。\n"
        "你要遵循 OpenClaw 风格的 durable memory 原则：\n"
        "1. 长期记忆只保留跨会话稳定、可复用、会影响后续提醒与干预策略的信息。\n"
        "2. 一次性碎片、证据不足的猜测、纯日志式叙述不要晋升。\n"
        "3. 如果信息更适合作为当天记录，应留在 daily note，而不是写入 MEMORY.md。\n"
        f"4. 当前事件来源是：{source_label}。\n"
        f"5. memory_bucket 必须从 {', '.join(_MEMORY_BUCKETS)} 中选一个。\n"
        "6. salience_score 取值 0~1，表示这条信息对长期画像的显著性。\n"
        "7. 只输出 JSON。"
    )


def build_detection_memory_assessment_prompts(
    *,
    user_context: dict[str, Any],
    existing_profile_summary: str | None,
    current_event: dict[str, Any],
    recent_candidates: list[dict[str, Any]],
) -> tuple[str, str]:
    system_prompt = _base_assess_system_prompt("检测结果")
    user_prompt = f"""
请完成“检测事件长期记忆评估”，只输出 JSON。

【输出 JSON schema】
{_json_dump(_ASSESS_SCHEMA)}

【评估要求】
1. should_promote=true 仅用于以下情况：
   - 反映用户稳定风险模式、反复出现的易感点、固定沟通弱点；
   - 能直接影响今后提醒策略、监护策略、对话风格或风险阈值；
   - 不是一次性描述，而是可复用的画像结论。
2. urgency_delta 取值 0~40，越高表示越应尽快整理进长期记忆。
3. candidate_memory 必须是可以直接写入 MEMORY.md 的中文句子，建议 20~90 字。
4. query_tags 最多 6 个，优先保留诈骗类型、场景、对象、行为模式。
5. 如果本次材料主要是附件不足、信息不足、一次性噪声，则应倾向 should_promote=false。

【当前用户】
{_json_dump(user_context)}

【已有长期画像摘要】
{existing_profile_summary or "暂无"}

【近期候选记忆】
{_json_dump(recent_candidates[: settings.user_profile_recent_result_limit])}

【当前检测事件】
{_json_dump(current_event)}
""".strip()
    return system_prompt, user_prompt


def build_assistant_memory_assessment_prompts(
    *,
    user_context: dict[str, Any],
    existing_profile_summary: str | None,
    current_event: dict[str, Any],
    recent_candidates: list[dict[str, Any]],
) -> tuple[str, str]:
    system_prompt = _base_assess_system_prompt("助手对话")
    user_prompt = f"""
请完成“助手对话长期记忆评估”，只输出 JSON。

【输出 JSON schema】
{_json_dump(_ASSESS_SCHEMA)}

【评估要求】
1. should_promote=true 仅用于以下情况：
   - 对话暴露出稳定偏好、长期行为习惯、固定关系场景、重复求证模式；
   - 暴露出长期风险点，例如常见被骗场景、容易受谁影响、对什么话术容易迟疑；
   - 形成可长期复用的沟通/防护策略。
2. 一般性的寒暄、一次性问题、无稳定模式的随机聊天不要晋升。
3. candidate_memory 要抽象成画像，不要照抄聊天原文。
4. memory_bucket 可用于区分风险模式、沟通方式、偏好、防护习惯、关系线索。
5. 若对话体现“遇到风险会主动求证”这类稳定保护习惯，也可以晋升到 protection。

【当前用户】
{_json_dump(user_context)}

【已有长期画像摘要】
{existing_profile_summary or "暂无"}

【近期候选记忆】
{_json_dump(recent_candidates[: settings.user_profile_recent_result_limit])}

【当前助手对话事件】
{_json_dump(current_event)}
""".strip()
    return system_prompt, user_prompt


def build_profile_merge_prompts(
    *,
    user_context: dict[str, Any],
    existing_profile_summary: str | None,
    prior_candidate_memories: list[str],
    candidate_memory: str,
    recent_candidates: list[dict[str, Any]],
) -> tuple[str, str]:
    system_prompt = (
        "你是反诈系统里的长期画像整理器。\n"
        "你的任务是把已有长期画像与新晋升的候选记忆合并成更稳定、更可复用的用户画像摘要。\n"
        "要求：摘要必须像 MEMORY.md 的开头画像，而不是事件流水账；保留稳定风险特征、关系线索、保护习惯与沟通特点。\n"
        "只输出 JSON。"
    )
    user_prompt = f"""
请完成“长期画像合并更新”，只输出 JSON。

【输出 JSON schema】
{_json_dump(_MERGE_SCHEMA)}

【合并要求】
1. profile_summary 控制在 {settings.user_profile_summary_max_length} 字内；
2. 只保留跨会话稳定、可复用的信息；
3. 不要重复堆叠同义表达，不要写成按时间排序的流水账；
4. 如果新候选记忆只是补强已有画像，应重写成更完整的一句话画像；
5. merge_reason 用一句话说明这次画像为什么发生变化。

【当前用户】
{_json_dump(user_context)}

【已有长期画像摘要】
{existing_profile_summary or "暂无"}

【历史候选记忆】
{_json_dump(prior_candidate_memories)}

【近期候选记忆详情】
{_json_dump(recent_candidates[: settings.user_profile_recent_result_limit])}

【本次新晋升候选记忆】
{candidate_memory}
""".strip()
    return system_prompt, user_prompt
