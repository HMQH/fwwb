"""检测分析提示词。"""
from __future__ import annotations

import json
from typing import Any

from app.domain.detection.retrieval import RetrievalBundle, format_evidence
from app.domain.detection.rules import RuleAnalysis
from app.shared.core.config import settings


_OUTPUT_SCHEMA = {
    "risk_level": "low | medium | high",
    "fraud_type": "最可能的诈骗类型，无法判断时写 未知",
    "confidence": 0.0,
    "is_fraud": True,
    "summary": "40字内总结",
    "stage_tags": ["hook", "pressure", "instruction", "payment", "cover_up"],
    "hit_rules": ["索要验证码"],
    "input_highlights": [
        {"text": "验证码", "reason": "诈骗方索要验证码"}
    ],
    "final_reason": "结合输入、规则命中、黑白样本对比后的中文解释",
    "advice": ["不要提供验证码"],
    "need_manual_review": False,
}


def _json_dump(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_detection_prompts(
    *,
    text: str,
    rule_analysis: RuleAnalysis,
    retrieval: RetrievalBundle,
) -> tuple[str, str]:
    prompt_text_limit = settings.detection_prompt_text_limit
    clipped_text = text[:prompt_text_limit]

    black_payload = [format_evidence(hit) for hit in retrieval.black_hits]
    white_payload = [format_evidence(hit) for hit in retrieval.white_hits]

    system_prompt = (
        "你是反诈文本检测分析器。"
        "你必须严格基于输入文本、规则命中、黑白样本检索结果给出判断，"
        "不得虚构证据，不得输出 JSON 之外的文字。"
        "若证据不足，必须降低 confidence 并说明原因。"
    )

    user_prompt = f"""
请分析下面这段文本是否存在诈骗风险，并只输出 JSON。

【风险分级定义】
- high: 明显存在诈骗话术或高危指令（索要验证码、转账、远控、下载未知APP等）
- medium: 存在较强风险，但仍需要用户进一步核验
- low: 当前更接近正常沟通，或证据明显不足

【输出 JSON schema】
{_json_dump(_OUTPUT_SCHEMA)}

【待分析文本】
{clipped_text}

【规则分析】
{_json_dump(rule_analysis.to_json())}

【召回到的黑样本证据】
{_json_dump(black_payload)}

【召回到的白样本证据】
{_json_dump(white_payload)}

请重点完成：
1. 判断该文本更像黑样本还是白样本；
2. 给出最可能的 fraud_type；
3. 如果有明显高危指令，risk_level 必须提高；
4. input_highlights 只能引用原文中真实出现的短语；
5. advice 必须是可执行的用户建议。
""".strip()

    return system_prompt, user_prompt
