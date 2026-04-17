from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domain.agent.state import AgentState
from app.domain.agent.types import EvidenceItem, SkillResult
from app.domain.detection import analyzer
from app.shared.core.config import settings
from app.shared.observability.langsmith import traceable


def _collect_text_input(state: AgentState) -> tuple[str | None, dict[str, Any]]:
    direct_text = str(state.get("text_content") or "").strip()
    sources: list[str] = []
    merged_parts: list[str] = []

    if direct_text:
        merged_parts.append(direct_text)
        sources.append("submission_text")

    ocr_text = ""
    ocr_provider = None
    ocr_result = state.get("ocr_result") or {}
    if isinstance(ocr_result, dict):
        raw_payload = ocr_result.get("raw")
        if isinstance(raw_payload, dict):
            ocr_provider = str(raw_payload.get("provider") or "").strip() or None
            ocr_text = str(raw_payload.get("aggregated_text") or "").strip()

    if ocr_text and (ocr_text != direct_text):
        if direct_text:
            merged_parts.append(f"[OCR]\n{ocr_text}")
            sources.append("ocr_text")
        elif (ocr_provider or "").lower() != "stub":
            merged_parts.append(ocr_text)
            sources.append("ocr_text")

    merged_text = "\n\n".join(part for part in merged_parts if part).strip()
    return (
        merged_text or None,
        {
            "sources": sources,
            "ocr_provider": ocr_provider,
            "has_direct_text": bool(direct_text),
            "has_ocr_text": bool(ocr_text),
            "ocr_text_length": len(ocr_text),
        },
    )


def _build_text_evidence(payload: dict[str, Any]) -> list[EvidenceItem]:
    evidence: list[EvidenceItem] = []

    for item in list(payload.get("input_highlights") or [])[:3]:
        text = str(item.get("text") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if not text:
            continue
        evidence.append(
            EvidenceItem(
                skill="text_rag_skill",
                title="文本高亮",
                detail=f"{text} | {reason}" if reason else text,
                severity="warning",
            )
        )

    for item in list(payload.get("retrieved_evidence") or [])[:3]:
        chunk_text = str(item.get("chunk_text") or "").strip()
        reason = str(item.get("reason") or "").strip()
        fraud_type = str(item.get("fraud_type") or "").strip()
        title = "RAG 命中风险样本"
        if fraud_type:
            title = f"RAG 命中：{fraud_type}"
        if not chunk_text:
            continue
        evidence.append(
            EvidenceItem(
                skill="text_rag_skill",
                title=title,
                detail=f"{chunk_text} | {reason}" if reason else chunk_text,
                severity="warning",
                extra={
                    "source_id": item.get("source_id"),
                    "match_source": item.get("match_source"),
                    "similarity_score": item.get("similarity_score"),
                },
            )
        )

    return evidence


@traceable(name="agent.skill.text_rag_skill", run_type="chain")
def run_text_rag_skill(state: AgentState) -> dict[str, object]:
    session = state.get("db_session")
    if not isinstance(session, Session):
        result = SkillResult(
            name="text_rag_skill",
            status="failed",
            summary="Text RAG skill could not start because the database session is missing.",
        )
        return {"text_rag_result": result.to_dict()}

    merged_text, input_meta = _collect_text_input(state)
    result = SkillResult(
        name="text_rag_skill",
        status="completed",
        summary="No reusable text was available for text RAG analysis.",
        raw={"input_meta": input_meta},
    )

    if not merged_text:
        if not input_meta.get("has_direct_text") and input_meta.get("has_ocr_text") and input_meta.get("ocr_provider") == "stub":
            result.status = "skipped"
            result.summary = "Image OCR is still in stub mode, so text RAG was skipped for image-only input."
        else:
            result.status = "skipped"
            result.summary = "No direct text or real OCR text was available for text RAG."
        return {"text_rag_input": None, "text_rag_result": result.to_dict()}

    analysis = analyzer.analyze_text_submission(session, text=merged_text)
    payload = dict(analysis.result_payload or {})
    confidence = float(payload.get("confidence") or 0.0)

    result.triggered = True
    result.risk_score = round(confidence, 3)
    result.summary = str(payload.get("summary") or "Text RAG produced a structured risk judgment.").strip()
    result.labels = [f"text_rag_{str(payload.get('risk_level') or 'unknown').lower()}"]
    result.recommendations = list(payload.get("advice") or [])[:4]
    result.evidence = _build_text_evidence(payload)
    result.raw = {
        "input_text": merged_text,
        "input_meta": input_meta,
        "llm_model": analysis.llm_model,
        "rule_score": analysis.rule_score,
        "retrieval_query": analysis.retrieval_query,
        "result_payload": payload,
        "llm_used": bool(payload.get("result_detail", {}).get("llm_used")),
        "semantic_rule_used": bool(payload.get("result_detail", {}).get("semantic_rule_used")),
        "ocr_provider": settings.ocr_provider,
    }

    return {
        "text_rag_input": merged_text,
        "text_rag_result": result.to_dict(),
    }
