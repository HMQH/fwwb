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
        summary="No obvious sensitive information was detected.",
        raw=detection,
    )

    if not hits:
        return {"pii_result": result.to_dict()}

    result.triggered = True
    result.risk_score = round(min(0.25 + len(hits) * 0.15, 0.95), 3)
    result.summary = "Sensitive personal or financial information appears in the available text."
    result.labels = sorted({f"pii_{item['type']}" for item in hits})
    result.recommendations.append("Mask personal identifiers before sharing screenshots or documents.")
    result.recommendations.append("Do not send verification codes, ID numbers, or bank card numbers to strangers.")

    for item in hits:
        result.evidence.append(
            EvidenceItem(
                skill="pii_guard",
                title=f"Detected {item['type']}",
                detail=f"Matched value: {item['value']}",
                severity="warning",
            )
        )

    return {"pii_result": result.to_dict()}
