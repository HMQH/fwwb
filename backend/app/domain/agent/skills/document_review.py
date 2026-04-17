from __future__ import annotations

from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.types import EvidenceItem, SkillResult
from app.domain.detection import llm
from app.shared.observability.langsmith import traceable


def _build_llm_review(text: str) -> dict[str, Any] | None:
    if not text or len(text) < 20:
        return None
    try:
        client = llm.build_chat_json_client()
    except Exception:
        return None

    system_prompt = (
        "You are a fraud analyst reviewing OCR text from formal-looking Chinese documents. "
        "Return strict JSON only."
    )
    user_prompt = (
        "Analyze whether this text looks like a forged official document scam. "
        "Focus on fake court summons, fake government notices, forged seals, urgent payment demands, "
        "private contact channels, and document-format defects.\n\n"
        "Return JSON with keys: verdict (string), risk_score (number 0-1), confidence (number 0-1), "
        "document_type (string), suspicious_points (array of strings), authenticity_gaps (array of strings), "
        "recommended_actions (array of strings), need_manual_review (bool), summary (string), labels (array of strings).\n\n"
        f"OCR text:\n{text[:2600]}"
    )
    try:
        response = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
    except Exception:
        return None
    payload = dict(response.payload or {})
    payload["llm_model"] = response.model_name
    return payload


@traceable(name="agent.skill.document_review", run_type="chain")
def run_document_review(state: AgentState) -> dict[str, object]:
    official = state.get("official_document_result") or {}
    result = SkillResult(
        name="document_review",
        status="completed",
        summary="No suspicious official-document signal required a second-pass review.",
        raw={"source": "official_document_checker"},
    )

    if not isinstance(official, dict) or not official:
        result.status = "skipped"
        result.summary = "Document review was skipped because official-document analysis has not run yet."
        return {"document_review_result": result.to_dict()}

    raw = official.get("raw") if isinstance(official.get("raw"), dict) else {}
    heuristic = raw.get("heuristic") if isinstance(raw.get("heuristic"), dict) else {}
    llm_review = raw.get("llm_review") if isinstance(raw.get("llm_review"), dict) else None
    text = str(raw.get("input_text") or "").strip()
    second_pass_llm = _build_llm_review(text)

    suspicious_points: list[str] = []
    suspicious_points.extend(str(item).strip() for item in list((llm_review or {}).get("suspicious_points") or []) if str(item).strip())
    suspicious_points.extend(str(item).strip() for item in list((second_pass_llm or {}).get("suspicious_points") or []) if str(item).strip())
    authenticity_gaps = [str(item).strip() for item in list((second_pass_llm or {}).get("authenticity_gaps") or []) if str(item).strip()]
    recommended_actions = [str(item).strip() for item in list((second_pass_llm or {}).get("recommended_actions") or []) if str(item).strip()]

    candidate = bool(heuristic.get("candidate"))
    suspicious_forgery = bool(heuristic.get("suspicious_forgery")) or bool((llm_review or {}).get("suspicious_forgery"))
    if isinstance(second_pass_llm, dict):
        verdict = str(second_pass_llm.get("verdict") or "").strip().lower()
        suspicious_forgery = suspicious_forgery or verdict in {"suspicious_forgery", "likely_forgery", "fake"}
    else:
        verdict = ""

    base_score = float(official.get("risk_score") or 0.0)
    second_pass_score = 0.0
    confidence = 0.0
    if isinstance(second_pass_llm, dict):
        try:
            second_pass_score = float(second_pass_llm.get("risk_score") or 0.0)
        except (TypeError, ValueError):
            second_pass_score = 0.0
        try:
            confidence = float(second_pass_llm.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

    if candidate and suspicious_forgery:
        second_pass_score = max(second_pass_score, base_score, 0.74)
    elif candidate:
        second_pass_score = max(second_pass_score, base_score, 0.36)

    result.triggered = bool(candidate or suspicious_points or authenticity_gaps)
    result.risk_score = round(min(max(base_score, second_pass_score), 0.97), 3)
    result.raw.update(
        {
            "heuristic": heuristic,
            "first_pass_llm_review": llm_review,
            "second_pass_llm_review": second_pass_llm,
            "input_text": text,
        }
    )

    labels: list[str] = []
    if candidate:
        labels.append("document_review_candidate")
    if suspicious_forgery:
        labels.append("document_review_forgery_suspected")
    if authenticity_gaps:
        labels.append("document_review_authenticity_gap")
    if recommended_actions:
        labels.append("document_review_actionable")
    result.labels = labels

    if suspicious_forgery:
        result.summary = "Second-pass document review found forged-official-document cues that are consistent with scam notices."
    elif candidate:
        result.summary = "The image looks like a formal document, but only moderate forgery cues were found in the second-pass review."
    else:
        result.summary = "The current image does not strongly resemble a forged official document after second-pass review."

    for point in suspicious_points[:4]:
        result.evidence.append(
            EvidenceItem(
                skill="document_review",
                title="Forgery cue",
                detail=point,
                severity="warning",
            )
        )
    for gap in authenticity_gaps[:3]:
        result.evidence.append(
            EvidenceItem(
                skill="document_review",
                title="Authenticity gap",
                detail=gap,
                severity="warning",
            )
        )

    result.recommendations.extend(
        [
            "不要根据截图里的电话、二维码、微信号去核验公文真伪。",
            "优先通过法院、政府、公安等机构官网公开电话或线下窗口核验。",
        ]
    )
    result.recommendations.extend(recommended_actions[:3])

    if isinstance(second_pass_llm, dict) and second_pass_llm.get("summary"):
        result.summary = str(second_pass_llm.get("summary")).strip()
    if not text and not candidate:
        result.status = "skipped"
        result.summary = "Document review was skipped because no OCR text or strong document cues were available."
        result.risk_score = 0.0

    if confidence >= 0.75 and suspicious_forgery:
        result.recommendations.append("该材料应优先进入人工复核或证据保全流程。")

    return {"document_review_result": result.to_dict()}
