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

    system_prompt = "你是反诈审核员，负责复核正式文书风格的 OCR 文本。只返回严格 JSON，summary、suspicious_points、authenticity_gaps、recommended_actions 必须使用中文。"
    user_prompt = (
        "请判断这段文字是否像仿冒公文诈骗，重点关注假传票、假政府通知、伪造公章、紧急缴费要求、"
        "私人联系方式和文书格式缺陷。\n\n"
        "返回 JSON，字段必须包含：verdict、risk_score、confidence、document_type、suspicious_points、"
        "authenticity_gaps、recommended_actions、need_manual_review、summary、labels。\n\n"
        f"OCR 文本：\n{text[:2600]}"
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
        summary="当前没有需要进入二次文书复核的强线索。",
        raw={"source": "official_document_checker"},
    )

    if not isinstance(official, dict) or not official:
        result.status = "skipped"
        result.summary = "公文初筛尚未运行，因此跳过二次文书复核。"
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
        result.summary = "二次文书复核发现了与仿冒公文诈骗一致的伪造线索。"
    elif candidate:
        result.summary = "图片看起来像正式文书，但二次复核仅发现中等强度的伪造线索。"
    else:
        result.summary = "经过二次复核，当前图片暂未表现出强烈的仿冒公文特征。"

    for point in suspicious_points[:4]:
        result.evidence.append(
            EvidenceItem(
                skill="document_review",
                title="伪造线索",
                detail=point,
                severity="warning",
            )
        )
    for gap in authenticity_gaps[:3]:
        result.evidence.append(
            EvidenceItem(
                skill="document_review",
                title="真实性缺口",
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
        result.summary = "当前没有可用文字或强公文线索，因此跳过二次文书复核。"
        result.risk_score = 0.0

    if confidence >= 0.75 and suspicious_forgery:
        result.recommendations.append("该材料应优先进入人工复核或证据保全流程。")

    return {"document_review_result": result.to_dict()}
