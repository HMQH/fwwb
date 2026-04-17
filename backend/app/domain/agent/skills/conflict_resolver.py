from __future__ import annotations

from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


def _level_rank(level: str | None) -> int:
    return {"info": 0, "low": 1, "medium": 2, "high": 3}.get(str(level or "").lower(), 0)


def _risk_level_from_score(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    if score > 0:
        return "low"
    return "info"


def _image_branch_summary(state: AgentState) -> dict[str, Any]:
    keys = [
        "qr_result",
        "ocr_result",
        "official_document_result",
        "pii_result",
        "impersonation_result",
        "image_similarity_result",
        "document_review_result",
    ]
    payloads = [state.get(key) for key in keys if isinstance(state.get(key), dict)]
    max_score = max((float((payload or {}).get("risk_score") or 0.0) for payload in payloads), default=0.0)
    labels: list[str] = []
    for payload in payloads:
        for label in list((payload or {}).get("labels") or []):
            if label not in labels:
                labels.append(label)
    return {
        "score": max_score,
        "risk_level": _risk_level_from_score(max_score),
        "labels": labels,
    }


@traceable(name="agent.skill.conflict_resolver", run_type="chain")
def run_conflict_resolver(state: AgentState) -> dict[str, object]:
    text_skill = state.get("text_rag_result") or {}
    image_summary = _image_branch_summary(state)
    result = SkillResult(
        name="conflict_resolver",
        status="completed",
        summary="No branch conflict required a dedicated resolution step.",
        raw={},
    )

    if not isinstance(text_skill, dict) or not text_skill:
        result.status = "skipped"
        result.summary = "Conflict resolver was skipped because the text branch did not run."
        return {"conflict_resolution_result": result.to_dict()}

    raw = text_skill.get("raw") if isinstance(text_skill.get("raw"), dict) else {}
    payload = raw.get("result_payload") if isinstance(raw.get("result_payload"), dict) else {}
    text_score = float(payload.get("confidence") or text_skill.get("risk_score") or 0.0)
    text_level = str(payload.get("risk_level") or _risk_level_from_score(text_score)).lower()
    image_level = str(image_summary.get("risk_level") or "info").lower()
    image_score = float(image_summary.get("score") or 0.0)

    level_gap = abs(_level_rank(text_level) - _level_rank(image_level))
    has_conflict = level_gap >= 2 or (text_score <= 0.24 and image_score >= 0.56) or (text_score >= 0.7 and image_score <= 0.18)
    result.triggered = has_conflict
    result.risk_score = round(max(text_score, image_score), 3)
    result.raw = {
        "text_risk_level": text_level,
        "text_score": round(text_score, 4),
        "image_risk_level": image_level,
        "image_score": round(image_score, 4),
        "image_labels": list(image_summary.get("labels") or []),
        "has_conflict": has_conflict,
        "level_gap": level_gap,
    }

    if has_conflict:
        result.labels = ["branch_conflict_detected", f"text_{text_level}", f"image_{image_level}"]
        result.summary = "The text branch and image branch produced materially different risk judgments, so the case should be resolved conservatively."
        result.evidence.append(
            EvidenceItem(
                skill="conflict_resolver",
                title="Branch disagreement",
                detail=f"Text branch={text_level} ({text_score:.2f}), image branch={image_level} ({image_score:.2f}).",
                severity="warning",
            )
        )
        result.recommendations.extend(
            [
                "以更高风险分支为准，不要因为其中一个分支偏低就直接放行。",
                "把冲突样本打到人工复核，查看原图、对话上下文和账号资料。",
            ]
        )
    else:
        result.labels = ["branch_conflict_not_found"]
        result.summary = "The text and image branches are broadly aligned, so no extra conflict handling is needed."

    return {"conflict_resolution_result": result.to_dict()}
