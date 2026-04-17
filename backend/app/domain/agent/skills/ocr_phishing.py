from __future__ import annotations

from app.domain.agent.state import AgentState
from app.domain.agent.tools.ocr_tool import extract_texts
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


PHISHING_PATTERNS: dict[str, list[str]] = {
    "urgency": ["最后机会", "立即领取", "限时", "马上处理", "立即登录", "立即验证"],
    "authority": ["官方指定", "官方通知", "公安", "银行", "客服", "安全中心"],
    "reward": ["高收益", "稳赚", "返利", "免费提现", "中奖", "补贴"],
    "fear": ["冻结", "封号", "异常", "风险账户", "涉嫌", "停用"],
}

CATEGORY_LABELS = {
    "urgency": "紧迫催促",
    "authority": "冒充权威",
    "reward": "利益诱导",
    "fear": "威胁恐吓",
}


@traceable(name="agent.skill.ocr_phishing", run_type="chain")
def run_ocr_phishing(state: AgentState) -> dict[str, object]:
    ocr_payload = extract_texts(
        image_paths=state.get("image_paths", []),
        fallback_text=state.get("text_content"),
    )
    text = str(ocr_payload.get("aggregated_text", "")).strip()

    result = SkillResult(
        name="ocr_phishing",
        summary="未发现明显诱导或钓鱼话术。",
        raw=ocr_payload,
    )

    if not text:
        result.summary = "当前还没有可提取文字，文字识别结果暂不完整。"
        return {"ocr_result": result.to_dict()}

    total_score = 0.0
    for category, phrases in PHISHING_PATTERNS.items():
        for phrase in phrases:
            if phrase in text:
                total_score += 0.18
                label = f"copy_{category}"
                if label not in result.labels:
                    result.labels.append(label)
                result.evidence.append(
                    EvidenceItem(
                        skill="ocr_phishing",
                        title=f"命中{CATEGORY_LABELS.get(category, category)}词",
                        detail=f"命中短语：{phrase}",
                        severity="warning",
                    )
                )

    result.triggered = bool(result.labels)
    result.risk_score = round(min(total_score, 0.95), 3)

    if result.triggered:
        result.summary = "提取文字中存在诱导或钓鱼式话术。"
        result.recommendations.append("操作前先通过官方渠道核验通知真伪。")
        if "copy_authority" in result.labels:
            result.recommendations.append("涉及官方、银行、客服等权威说法前，先核实再处理。")
    elif ocr_payload.get("provider") == "stub":
        result.summary = "当前仅有基础文字识别提示，诱导识别能力有限。"

    return {"ocr_result": result.to_dict()}
