from __future__ import annotations

from app.domain.agent.state import AgentState
from app.domain.agent.tools.pii_tool import detect_sensitive_items
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


@traceable(name="agent.skill.pii_guard", run_type="chain")
def run_pii_guard(state: AgentState) -> dict[str, object]:
    collected_text = [state.get("text_content") or ""]
    ocr_result = state.get("ocr_result") or {}
    raw_payload = ocr_result.get("raw") if isinstance(ocr_result, dict) else None
    if isinstance(raw_payload, dict):
        aggregated_text = str(raw_payload.get("aggregated_text") or "").strip()
        if aggregated_text:
            collected_text.append(aggregated_text)

    detection = detect_sensitive_items("\n".join(part for part in collected_text if part).strip())
    hits = detection.get("hits", [])

    result = SkillResult(
        name="pii_guard",
        summary="未发现明显敏感信息。",
        raw=detection,
    )

    if not hits:
        return {"pii_result": result.to_dict()}

    result.triggered = True
    result.risk_score = round(min(0.25 + len(hits) * 0.15, 0.95), 3)
    result.summary = "可用文字中出现了敏感个人或金融信息。"
    result.labels = sorted({f"pii_{item['type']}" for item in hits})
    result.recommendations.append("分享截图或证件前，先遮挡个人敏感信息。")
    result.recommendations.append("不要把验证码、身份证号或银行卡号发送给陌生人。")

    for item in hits:
        pii_type = {
            "phone": "手机号",
            "id_card": "身份证号",
            "bank_card": "银行卡号",
            "verification_code": "验证码",
        }.get(str(item["type"]), str(item["type"]))
        result.evidence.append(
            EvidenceItem(
                skill="pii_guard",
                title=f"命中{pii_type}",
                detail=f"命中内容：{item['value']}",
                severity="warning",
            )
        )

    return {"pii_result": result.to_dict()}
