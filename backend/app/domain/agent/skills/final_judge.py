from __future__ import annotations

from typing import Any

from app.domain.agent.advice import build_final_advice
from app.domain.agent.fraud_types import (
    FRAUD_TYPE_FORGED_DOC,
    FRAUD_TYPE_IMPERSONATION,
    FRAUD_TYPE_PHISHING_IMAGE,
    FRAUD_TYPE_PII,
    FRAUD_TYPE_SUSPICIOUS_QR,
    is_qr_fraud_type,
    normalize_fraud_type_display,
)
from app.domain.agent.state import AgentState
from app.domain.agent.trace import action_label, build_execution_trace_item, build_planner_trace_item
from app.shared.observability.langsmith import traceable


def _risk_level_from_score(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    if score > 0:
        return "low"
    return "info"


def _level_rank(level: str | None) -> int:
    return {"info": 0, "low": 1, "medium": 2, "high": 3}.get(str(level or "").lower(), 0)


def _video_risk_rank(level: str | None) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(str(level or "").strip().lower(), 0)


def _soft_video_behavior_risk(level: str | None) -> str:
    normalized = str(level or "").strip().lower()
    if normalized == "high":
        return "medium"
    if normalized == "medium":
        return "medium"
    return "low"


def _video_behavior_rule_name(level: str | None) -> str:
    return {
        "high": "人物行为 / 生理异常明显",
        "medium": "人物行为 / 生理波动偏高",
        "low": "人物行为 / 生理波动平稳",
    }.get(str(level or "").strip().lower(), "人物行为分析")


def _pick_image_fraud_type(labels: list[str]) -> str | None:
    if any(label.startswith("impersonation_") or label.startswith("image_similarity_") for label in labels):
        return FRAUD_TYPE_IMPERSONATION
    if any(label.startswith("qr_") for label in labels):
        return FRAUD_TYPE_SUSPICIOUS_QR
    if any("official_doc" in label or "document_review" in label or label.startswith("forged_official_document") for label in labels):
        return FRAUD_TYPE_FORGED_DOC
    if any(label.startswith("copy_") for label in labels):
        return FRAUD_TYPE_PHISHING_IMAGE
    if any(label.startswith("pii_") for label in labels):
        return FRAUD_TYPE_PII
    return None


def _merge_unique_strings(*groups: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for group in groups:
        for item in group:
            value = str(item).strip()
            if not value or value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def _collect_skill_payloads(
    state: AgentState,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    image_keys = (
        "qr_result",
        "ocr_result",
        "official_document_result",
        "pii_result",
        "impersonation_result",
        "image_similarity_result",
        "document_review_result",
    )
    image_skills: list[dict[str, Any]] = []
    for key in image_keys:
        payload = state.get(key)
        if isinstance(payload, dict) and payload and payload.get("status") != "skipped":
            image_skills.append(payload)

    text_skill = state.get("text_rag_result")
    if not isinstance(text_skill, dict) or text_skill.get("status") == "skipped":
        text_skill = None

    video_skills: list[dict[str, Any]] = []
    for key in ("video_ai_result", "video_deception_result"):
        payload = state.get(key)
        if isinstance(payload, dict) and payload and payload.get("status") != "skipped":
            video_skills.append(payload)

    other_skills: list[dict[str, Any]] = []
    for key in ("conflict_resolution_result",):
        payload = state.get(key)
        if isinstance(payload, dict) and payload and payload.get("status") != "skipped":
            other_skills.append(payload)

    all_skills = list(image_skills)
    if text_skill:
        all_skills.append(text_skill)
    all_skills.extend(video_skills)
    all_skills.extend(other_skills)
    return all_skills, image_skills, text_skill, video_skills


def _collect_labels(skills: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for skill in skills:
        for label in list(skill.get("labels") or []):
            if label not in labels:
                labels.append(label)
    return labels


def _collect_evidence(skills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for skill in skills:
        for item in list(skill.get("evidence") or []):
            key = (
                str(item.get("skill") or ""),
                str(item.get("title") or ""),
                str(item.get("detail") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            evidence.append(item)
    return evidence


def _similar_image_key(item: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(item.get("source_url") or "").strip(),
        str(item.get("image_url") or "").strip(),
        str(item.get("thumbnail_url") or "").strip(),
    )


def _build_similar_images(state: AgentState) -> list[dict[str, Any]]:
    display_limit = 8
    impersonation_payload = state.get("impersonation_result") or {}
    if not isinstance(impersonation_payload, dict):
        return []

    raw = impersonation_payload.get("raw")
    if not isinstance(raw, dict):
        return []

    raw_matches = [item for item in list(raw.get("matches") or []) if isinstance(item, dict)]
    validation = raw.get("similarity_validation")
    validated_matches = (
        [item for item in list(validation.get("validated_matches") or []) if isinstance(item, dict)]
        if isinstance(validation, dict)
        else []
    )
    validated_map = {_similar_image_key(item): item for item in validated_matches}

    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for index, item in enumerate(raw_matches[:display_limit]):
        key = _similar_image_key(item)
        if key in seen:
            continue
        seen.add(key)
        validated = validated_map.get(key, {})
        title = str(item.get("title") or "").strip() or None
        source_url = str(item.get("source_url") or "").strip() or None
        image_url = str(item.get("image_url") or "").strip() or None
        thumbnail_url = str(item.get("thumbnail_url") or "").strip() or image_url
        domain = str(item.get("domain") or "").strip() or None

        normalized.append(
            {
                "id": f"similar-image-{index}",
                "title": title,
                "source_url": source_url,
                "image_url": image_url,
                "thumbnail_url": thumbnail_url,
                "domain": domain,
                "provider": str(item.get("provider") or "baidu"),
                "match_type": str(item.get("match_type") or "unknown"),
                "is_validated": bool(validated),
                "clip_similarity": validated.get("clip_similarity"),
                "hash_similarity": validated.get("hash_similarity"),
                "phash_distance": validated.get("phash_distance"),
                "dhash_distance": validated.get("dhash_distance"),
                "hash_near_duplicate": validated.get("hash_near_duplicate"),
                "clip_high_similarity": validated.get("clip_high_similarity"),
            }
        )

    return normalized


def _normalize_execution_trace_entry(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    action_name = str(item.get("action") or item.get("key") or "").strip()
    step_id = str(item.get("id") or "").strip()
    if not action_name or not step_id:
        return None
    return {
        "id": step_id,
        "action": action_name,
        "key": action_name,
        "label": str(item.get("label") or action_label(action_name)).strip() or action_label(action_name),
        "status": str(item.get("status") or "completed"),
        "iteration": int(item.get("iteration") or 0),
    }


def _build_module_trace(execution_trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in execution_trace:
        entry = _normalize_execution_trace_entry(item)
        if entry:
            normalized.append(entry)
    return normalized


def _build_reasoning_graph(
    execution_trace: list[dict[str, Any]],
    risk_level: str,
    final_score: float,
    evidence_count: int,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = [
        {
            "id": "submission",
            "label": "提交内容",
            "kind": "input",
            "tone": "primary",
            "lane": 0,
            "order": 0,
        }
    ]
    edges: list[dict[str, Any]] = []
    highlighted_path = ["submission"]

    for index, item in enumerate(execution_trace, start=1):
        entry = _normalize_execution_trace_entry(item)
        if not entry:
            continue
        module = entry["action"]
        node_id = entry["id"]
        nodes.append(
            {
                "id": node_id,
                "label": entry["label"],
                "kind": "agent_step",
                "tone": "warning" if module != "planner" else "primary",
                "lane": 1 if module != "final_judge" else 2,
                "order": index,
                "meta": {
                    "action": module,
                    "iteration": entry["iteration"],
                    "status": entry["status"],
                },
            }
        )
        previous = highlighted_path[-1]
        edges.append(
            {
                "id": f"edge:{previous}:{node_id}:{index}",
                "source": previous,
                "target": node_id,
                "kind": "analysis",
                "tone": "warning",
                "weight": 0.6,
            }
        )
        highlighted_path.append(node_id)

    return {
        "nodes": nodes,
        "edges": edges,
        "highlighted_path": highlighted_path,
        "highlighted_labels": [
            "提交内容"
            if node_id == "submission"
            else next(
                (str(node.get("label") or "") for node in nodes if str(node.get("id") or "") == node_id),
                node_id,
            )
            for node_id in highlighted_path
        ],
        "lane_labels": ["输入", "分析流程", "判定"],
        "summary_metrics": {
            "step_count": len(execution_trace),
            "evidence_count": evidence_count,
            "final_score": round(final_score * 100),
            "risk_level": risk_level,
        },
    }


def _build_image_only_final_reason(evidence: list[dict[str, Any]], unsupported: list[str]) -> str:
    if evidence:
        titles = _merge_unique_strings([str(item.get("title") or "").strip() for item in evidence[:3]])
        base = f"图像分支命中 {len(evidence)} 条证据。"
        if titles:
            base += f" 关键线索包括：{'；'.join(titles)}。"
    else:
        base = "当前没有命中高置信度图像风险证据。"
    if unsupported:
        base += f" 另外已上传但暂未分析的模态：{', '.join(unsupported)}。"
    return base


def _qr_risk_level_from_score(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _build_qr_analysis(state: AgentState) -> dict[str, Any] | None:
    qr_result = state.get("qr_result")
    if not isinstance(qr_result, dict) or not qr_result:
        return None

    raw = qr_result.get("raw") if isinstance(qr_result.get("raw"), dict) else {}
    evidence_items = [item for item in list(qr_result.get("evidence") or []) if isinstance(item, dict)]
    decoded_matches = [item for item in list(raw.get("decoded_matches") or []) if isinstance(item, dict)]
    url_prediction_items = [
        item for item in list(raw.get("url_predictions") or raw.get("local_url_predictions") or []) if isinstance(item, dict)
    ]

    first_evidence = evidence_items[0] if evidence_items else {}
    first_match = decoded_matches[0] if decoded_matches else {}
    first_prediction = url_prediction_items[0] if url_prediction_items else {}
    extra = first_evidence.get("extra") if isinstance(first_evidence.get("extra"), dict) else {}

    payload = str(extra.get("payload") or first_match.get("payload") or "").strip() or None
    normalized_url = str(extra.get("normalized_url") or first_prediction.get("url") or "").strip() or None
    host = str(extra.get("host") or "").strip() or None
    destination_label = str(extra.get("destination_label") or "").strip() or None
    destination_kind = str(extra.get("destination_kind") or "").strip() or None
    local_risk_level = str(first_prediction.get("risk_level") or "").strip().lower() or None
    local_model_name = str(first_prediction.get("model_name") or "").strip() or None
    local_clues = [str(item).strip() for item in list(first_prediction.get("clues") or []) if str(item).strip()]
    try:
        phish_prob_raw = first_prediction.get("phish_prob")
        phish_prob = max(0.0, min(1.0, float(phish_prob_raw))) if phish_prob_raw is not None else None
    except (TypeError, ValueError):
        phish_prob = None
    qr_score = float(qr_result.get("risk_score") or 0.0)
    qr_risk_level = _qr_risk_level_from_score(qr_score)

    if not payload and not normalized_url and not destination_label:
        return None

    destination_text = destination_label or "未知去向"
    if host:
        destination_text = f"{destination_text}（{host}）"

    summary = f"已识别二维码，指向 {destination_text}。"
    reason_parts: list[str] = []
    if payload:
        reason_parts.append(f"二维码内容：{payload}")
    if normalized_url and normalized_url != payload:
        reason_parts.append(f"规范化链接：{normalized_url}")

    if local_risk_level == "high":
        summary = f"已识别二维码，指向 {destination_text}，本地网址模型判定为高风险。"
    elif local_risk_level == "medium":
        summary = f"已识别二维码，指向 {destination_text}，本地网址模型判定为中风险，建议不要直接打开。"
    elif local_risk_level == "suspicious":
        summary = f"已识别二维码，指向 {destination_text}，本地网址模型提示可疑，需进一步核验。"
    elif qr_score >= 0.5:
        summary = f"已识别二维码，指向 {destination_text}，包含较强风险线索，建议先核验再操作。"
    elif qr_score >= 0.3:
        summary = f"已识别二维码，指向 {destination_text}，当前存在一定诱导或跳转风险，需要核验。"

    if phish_prob is not None:
        reason_parts.append(f"本地模型钓鱼概率：{round(phish_prob * 100)}%")
    if local_clues:
        reason_parts.append(f"命中线索：{'；'.join(local_clues[:4])}")
    if local_model_name:
        reason_parts.append("检测模型：本地网址模型")

    return {
        "payload": payload,
        "normalized_url": normalized_url,
        "host": host,
        "destination_label": destination_label,
        "destination_kind": destination_kind,
        "local_risk_level": local_risk_level,
        "local_model_name": local_model_name,
        "phish_prob": round(phish_prob, 4) if phish_prob is not None else None,
        "clues": local_clues,
        "risk_score": round(qr_score, 4),
        "risk_level": qr_risk_level,
        "summary": summary,
        "final_reason": "；".join(part for part in reason_parts if part) or summary,
    }


def _build_video_analysis_modules(
    *,
    video_ai_summary: dict[str, Any],
    video_deception_summary: dict[str, Any],
) -> list[dict[str, Any]]:
    behavior_analyzed_count = int(video_deception_summary.get("analyzed_count") or 0)
    return [
        {
            "key": "d3_temporal",
            "label": "D3 Temporal",
            "status": "completed",
            "metrics": {
                "analyzed_count": int(video_ai_summary.get("analyzed_count") or 0),
                "suspicious_count": int(video_ai_summary.get("suspicious_count") or 0),
                "overall_risk_level": str(video_ai_summary.get("overall_risk_level") or "low"),
            },
        },
        {
            "key": "behavior_rppg",
            "label": "BehaviorRPPG",
            "status": "completed" if behavior_analyzed_count > 0 else "skipped",
            "metrics": {
                "analyzed_count": behavior_analyzed_count,
                "person_detected_count": int(video_deception_summary.get("person_detected_count") or 0),
                "skipped_no_face_count": int(video_deception_summary.get("skipped_no_face_count") or 0),
                "overall_risk_level": str(video_deception_summary.get("overall_risk_level") or "low"),
            },
        },
    ]


def _extract_video_branch(state: AgentState) -> dict[str, Any]:
    video_ai_payload = state.get("video_ai_result") or {}
    video_deception_payload = state.get("video_deception_result") or {}

    video_ai_raw = (
        video_ai_payload.get("raw")
        if isinstance(video_ai_payload, dict) and isinstance(video_ai_payload.get("raw"), dict)
        else {}
    )
    video_ai_batch = dict(video_ai_raw.get("batch_result") or {}) if isinstance(video_ai_raw, dict) else {}
    video_ai_summary = dict(video_ai_batch.get("summary") or (video_ai_raw.get("summary") or {}))
    video_ai_items = list(video_ai_batch.get("items") or (video_ai_raw.get("items") or []))
    video_ai_failed_items = list(video_ai_batch.get("failed_items") or (video_ai_raw.get("failed_items") or []))
    video_ai_lead = (
        video_ai_summary.get("lead_item")
        if isinstance(video_ai_summary.get("lead_item"), dict)
        else (video_ai_items[0] if video_ai_items else None)
    )

    video_deception_raw = (
        video_deception_payload.get("raw")
        if isinstance(video_deception_payload, dict) and isinstance(video_deception_payload.get("raw"), dict)
        else {}
    )
    video_deception_batch = (
        dict(video_deception_raw.get("behavior_result") or {})
        if isinstance(video_deception_raw, dict)
        else {}
    )
    video_deception_summary = dict(
        video_deception_batch.get("summary") or (video_deception_raw.get("summary") or {})
    )
    video_deception_items = list(video_deception_batch.get("items") or (video_deception_raw.get("items") or []))
    video_deception_failed_items = list(
        video_deception_batch.get("failed_items") or (video_deception_raw.get("failed_items") or [])
    )
    video_deception_lead = (
        video_deception_summary.get("lead_item")
        if isinstance(video_deception_summary.get("lead_item"), dict)
        else (video_deception_items[0] if video_deception_items else None)
    )

    return {
        "video_ai_summary": video_ai_summary,
        "video_ai_items": video_ai_items,
        "video_ai_failed_items": video_ai_failed_items,
        "video_ai_lead": video_ai_lead,
        "video_deception_summary": video_deception_summary,
        "video_deception_items": video_deception_items,
        "video_deception_failed_items": video_deception_failed_items,
        "video_deception_lead": video_deception_lead,
    }


def _needs_conflict_resolution(text_skill: dict[str, Any] | None, image_max_score: float) -> bool:
    if not isinstance(text_skill, dict):
        return False
    raw = text_skill.get("raw") if isinstance(text_skill.get("raw"), dict) else {}
    payload = raw.get("result_payload") if isinstance(raw.get("result_payload"), dict) else {}
    text_score = float(payload.get("confidence") or text_skill.get("risk_score") or 0.0)
    text_level = str(payload.get("risk_level") or _risk_level_from_score(text_score)).lower()
    image_level = _risk_level_from_score(image_max_score)
    level_gap = abs(_level_rank(text_level) - _level_rank(image_level))
    return level_gap >= 2 or (text_score <= 0.24 and image_max_score >= 0.56) or (text_score >= 0.72 and image_max_score <= 0.18)


def _infer_followup_actions(
    state: AgentState,
    image_skills: list[dict[str, Any]],
    text_skill: dict[str, Any] | None,
) -> tuple[list[str], str]:
    actions: list[str] = []

    impersonation = state.get("impersonation_result") or {}
    image_similarity = state.get("image_similarity_result") or {}
    if isinstance(impersonation, dict) and impersonation:
        raw = impersonation.get("raw") if isinstance(impersonation.get("raw"), dict) else {}
        matches = list(raw.get("matches") or [])
        validation = raw.get("similarity_validation") if isinstance(raw.get("similarity_validation"), dict) else {}
        validated_count = int(((validation.get("summary") or {}) if isinstance(validation, dict) else {}).get("validated_match_count") or 0)
        if matches and (validated_count == 0 or float(impersonation.get("risk_score") or 0.0) <= 0.6) and not image_similarity:
            actions.append("image_similarity_verifier")

    official = state.get("official_document_result") or {}
    document_review = state.get("document_review_result") or {}
    if isinstance(official, dict) and official:
        official_score = float(official.get("risk_score") or 0.0)
        official_labels = list(official.get("labels") or [])
        should_review_doc = official_score >= 0.22 or any(
            label in {"forged_official_document_suspected", "official_doc_candidate"}
            for label in official_labels
        )
        if should_review_doc and not document_review:
            actions.append("document_review")

    image_max_score = max((float(skill.get("risk_score") or 0.0) for skill in image_skills), default=0.0)
    conflict_resolution = state.get("conflict_resolution_result") or {}
    if _needs_conflict_resolution(text_skill, image_max_score) and not conflict_resolution:
        actions.append("conflict_resolver")

    if actions:
        return _merge_unique_strings(actions), "followup_required"
    return [], "final_decision_ready"


@traceable(name="agent.skill.final_judge", run_type="chain")
def run_final_judge(state: AgentState) -> dict[str, object]:
    skills, image_skills, text_skill, video_skills = _collect_skill_payloads(state)
    labels = _collect_labels(skills)
    evidence = _collect_evidence(skills)
    unsupported = list(state.get("unsupported_modalities") or [])
    has_video = bool(state.get("video_paths"))

    image_max_score = max((float(skill.get("risk_score") or 0.0) for skill in image_skills), default=0.0)
    image_fraud_type = _pick_image_fraud_type(labels)

    text_payload: dict[str, Any] = {}
    if text_skill:
        raw_payload = text_skill.get("raw")
        if isinstance(raw_payload, dict):
            text_payload = dict(raw_payload.get("result_payload") or {})

    text_score = float(text_payload.get("confidence") or (text_skill or {}).get("risk_score") or 0.0) if text_skill else 0.0
    final_score = max(text_score, image_max_score)

    if text_payload:
        risk_level = str(text_payload.get("risk_level") or _risk_level_from_score(final_score)).lower()
        image_level = _risk_level_from_score(image_max_score)
        if _level_rank(image_level) > _level_rank(risk_level):
            risk_level = image_level

        fraud_type = normalize_fraud_type_display(str(text_payload.get("fraud_type") or "").strip()) or image_fraud_type
        if image_fraud_type and image_max_score >= text_score + 0.12:
            fraud_type = image_fraud_type
        fraud_type = normalize_fraud_type_display(fraud_type)

        summary = str(text_payload.get("summary") or "").strip() or "文本分支已完成基础判断。"
        if image_skills and evidence:
            summary += f" 同时结合图像分支补充了 {len(evidence)} 条证据。"

        final_reason = str(text_payload.get("final_reason") or "").strip()
        if image_skills:
            final_reason = ((final_reason + " " if final_reason else "") + _build_image_only_final_reason(evidence, unsupported)).strip()

        stage_tags = _merge_unique_strings(list(text_payload.get("stage_tags") or []), ["agent_orchestrated", "planner_loop"])
        hit_rules = list(text_payload.get("hit_rules") or [])
        rule_hits = list(text_payload.get("rule_hits") or [])
        extracted_entities = dict(text_payload.get("extracted_entities") or {})
        input_highlights = list(text_payload.get("input_highlights") or [])
        retrieved_evidence = list(text_payload.get("retrieved_evidence") or [])
        counter_evidence = list(text_payload.get("counter_evidence") or [])
        need_manual_review = bool(text_payload.get("need_manual_review")) or bool(unsupported)
        llm_model = None
        raw_payload = text_skill.get("raw") if isinstance(text_skill, dict) else {}
        if isinstance(raw_payload, dict):
            llm_model = raw_payload.get("llm_model")
        confidence = max(text_score, image_max_score)
    else:
        risk_level = _risk_level_from_score(final_score)
        fraud_type = normalize_fraud_type_display(image_fraud_type)
        if image_skills:
            summary = f"图像分支完成了 {len(image_skills)} 个专项检查，命中了 {len(evidence)} 条证据。" if evidence else "图像分支已完成首轮检测。"
            final_reason = _build_image_only_final_reason(evidence, unsupported)
            stage_tags = ["agent_orchestrated", "image_branch", "planner_loop"]
        elif has_video:
            summary = "已完成视频分支检测，正在汇总 AI 时序与人物生理特征结果。"
            final_reason = "系统已完成视频检测流程，并汇总视频时序与人物生理特征线索。"
            stage_tags = ["agent_orchestrated", "video_branch", "planner_loop"]
        else:
            summary = "当前没有足够的直接文本或图像证据。"
            final_reason = "当前没有足够的直接文本或图像证据。"
            stage_tags = ["agent_orchestrated", "planner_loop"]
        if unsupported:
            summary += " 部分上传模态暂未分析。"
        hit_rules = []
        rule_hits = []
        pii_payload = state.get("pii_result") or {}
        pii_raw = pii_payload.get("raw") if isinstance(pii_payload, dict) else None
        extracted_entities = {"pii_hits": list((pii_raw or {}).get("hits") or [])} if isinstance(pii_raw, dict) else {}
        input_highlights = [
            {"text": str(item.get("detail") or ""), "reason": str(item.get("title") or "风险线索")}
            for item in evidence[:4]
            if str(item.get("detail") or "").strip()
        ]
        retrieved_evidence = []
        counter_evidence = []
        need_manual_review = bool(unsupported) or final_score < 0.4
        llm_model = None
        confidence = final_score

    qr_analysis = _build_qr_analysis(state)
    qr_result = state.get("qr_result")
    qr_branch_triggered = isinstance(qr_result, dict) and bool(qr_result.get("triggered"))
    qr_branch_dominant = is_qr_fraud_type(fraud_type) or (qr_branch_triggered and not text_payload)
    if qr_analysis and qr_branch_dominant:
        if (not text_payload) or image_max_score >= text_score:
            summary = str(qr_analysis.get("summary") or summary)
            final_reason = str(qr_analysis.get("final_reason") or final_reason)
        else:
            qr_reason = str(qr_analysis.get("final_reason") or "").strip()
            if qr_reason:
                final_reason = ((final_reason + " " if final_reason else "") + qr_reason).strip()

    video_branch = _extract_video_branch(state)
    video_ai_summary = dict(video_branch.get("video_ai_summary") or {})
    video_ai_items = list(video_branch.get("video_ai_items") or [])
    video_ai_failed_items = list(video_branch.get("video_ai_failed_items") or [])
    video_ai_lead = video_branch.get("video_ai_lead") if isinstance(video_branch.get("video_ai_lead"), dict) else None
    video_deception_summary = dict(video_branch.get("video_deception_summary") or {})
    video_deception_items = list(video_branch.get("video_deception_items") or [])
    video_deception_failed_items = list(video_branch.get("video_deception_failed_items") or [])
    video_deception_lead = (
        video_branch.get("video_deception_lead") if isinstance(video_branch.get("video_deception_lead"), dict) else None
    )

    if video_ai_summary or video_deception_summary:
        stage_tags = _merge_unique_strings(stage_tags, ["视频检测", "D3时序检测", "人脸行为分析"])

        if video_ai_summary:
            lead_file_name = str((video_ai_lead or {}).get("file_name") or "未命名视频").strip()
            lead_std = float((video_ai_lead or {}).get("second_order_std") or 0.0)
            lead_confidence = float((video_ai_lead or {}).get("confidence") or 0.0)
            overall_risk = str(video_ai_summary.get("overall_risk_level") or "low").strip().lower() or "low"
            lead_summary = str((video_ai_lead or {}).get("summary") or video_ai_summary.get("overall_summary") or "").strip()
            lead_reason = str((video_ai_lead or {}).get("final_reason") or "").strip()

            if lead_file_name:
                input_highlights.append({"text": lead_file_name, "reason": f"视频 STD {lead_std:.3f}"})
                extracted_entities["video_ai"] = {
                    "video_count": int(video_ai_summary.get("analyzed_count") or len(video_ai_items)),
                    "suspicious_count": int(video_ai_summary.get("suspicious_count") or 0),
                    "top_video": lead_file_name,
                    "second_order_std": lead_std,
                    "overall_risk_level": overall_risk,
                }

            confidence = max(confidence, lead_confidence)
            final_score = max(final_score, lead_confidence)

            if overall_risk in {"medium", "high"} and lead_file_name:
                hit_rules = _merge_unique_strings(hit_rules, ["AI视频时序异常"])
                rule_hits.append(
                    {
                        "name": "视频时序异常",
                        "category": "video_ai",
                        "risk_points": round(lead_confidence * 100),
                        "explanation": "视频时序特征明显异常，疑似存在 AI 生成或强篡改痕迹。",
                        "matched_texts": [lead_file_name],
                        "stage_tag": "D3时序检测",
                        "fraud_type_hint": "AI生成视频",
                    }
                )
                need_manual_review = True
                if _video_risk_rank(overall_risk) > _level_rank(risk_level):
                    risk_level = overall_risk
                    fraud_type = "AI生成视频"
                    summary = lead_summary or summary
                    final_reason = lead_reason or final_reason
                else:
                    if lead_summary and lead_summary not in summary:
                        summary = f"{summary}；补充视频时序检测异常。" if summary else lead_summary
                    if lead_reason and lead_reason not in final_reason:
                        final_reason = f"{final_reason}；补充：{lead_reason}" if final_reason else lead_reason

        if video_deception_summary:
            behavior_risk = _soft_video_behavior_risk(video_deception_summary.get("overall_risk_level"))
            behavior_confidence = float((video_deception_lead or {}).get("confidence") or 0.0)
            behavior_summary_text = str(
                video_deception_summary.get("overall_summary") or (video_deception_lead or {}).get("summary") or ""
            ).strip()
            confidence = max(confidence, behavior_confidence * 0.88)
            final_score = max(final_score, behavior_confidence * 0.88)

            if video_deception_lead:
                extracted_entities["video_deception"] = {
                    "overall_risk_level": str(video_deception_summary.get("overall_risk_level") or "low"),
                    "person_detected_count": int(video_deception_summary.get("person_detected_count") or 0),
                    "top_video": str(video_deception_lead.get("file_name") or "未命名视频").strip(),
                    "face_behavior_score": float(video_deception_lead.get("face_behavior_score") or 0.0),
                    "physiology_score": float(video_deception_lead.get("physiology_score") or 0.0),
                    "signal_quality": float(video_deception_lead.get("signal_quality") or 0.0),
                }

            if video_deception_lead and _video_risk_rank(behavior_risk) >= 2:
                hit_rules = _merge_unique_strings(hit_rules, ["人物行为/生理异常"])
                rule_hits.append(
                    {
                        "name": _video_behavior_rule_name(behavior_risk),
                        "category": "video_behavior",
                        "risk_points": round(behavior_confidence * 100),
                        "explanation": "检测到一定的人脸行为或生理波动，可作为辅助风险线索。",
                        "matched_texts": [str(video_deception_lead.get("file_name") or "未命名视频").strip()],
                        "stage_tag": "人脸行为分析",
                        "fraud_type_hint": "真人状态异常",
                    }
                )
                need_manual_review = True
                if behavior_summary_text and behavior_summary_text not in summary:
                    summary = f"{summary}；{behavior_summary_text}" if summary else behavior_summary_text
                if behavior_summary_text and behavior_summary_text not in final_reason:
                    final_reason = f"{final_reason}；补充：{behavior_summary_text}" if final_reason else behavior_summary_text
                if _video_risk_rank(behavior_risk) > _level_rank(risk_level):
                    risk_level = behavior_risk
                    fraud_type = fraud_type or "真人状态异常"

        if not fraud_type and has_video:
            fraud_type = "视频风险较低"

    followup_actions, followup_stop_reason = _infer_followup_actions(state, image_skills, text_skill)
    advice_bundle = build_final_advice(
        skills=skills,
        text_payload=text_payload,
        risk_level=risk_level,
        fraud_type=fraud_type,
        final_score=final_score,
        confidence=confidence,
        need_manual_review=need_manual_review or bool(followup_actions),
        unsupported_modalities=unsupported,
        evidence=evidence,
    )
    advice = list(advice_bundle.get("advice") or [])
    recommendations = list(advice_bundle.get("recommendations") or [])
    trace_action_name = "followup_router" if followup_actions else "final_judge"

    risk_labels = list(labels)
    if text_payload:
        risk_labels = _merge_unique_strings(risk_labels, [f"text_rag_{str(text_payload.get('risk_level') or 'unknown').lower()}"])

    current_sequence = int(state.get("action_instance_counter") or 0) + 1
    executed_steps = [
        build_planner_trace_item(),
        *list(state.get("execution_trace") or []),
        build_execution_trace_item(
            sequence=current_sequence,
            action_name=trace_action_name,
            iteration=int(state.get("iteration_count") or current_sequence),
        ),
    ]
    module_trace = _build_module_trace(executed_steps)
    similar_images = _build_similar_images(state)
    reasoning_graph = _build_reasoning_graph(
        execution_trace=executed_steps,
        risk_level=risk_level,
        final_score=final_score,
        evidence_count=len(evidence),
    )

    result_detail = {
        "reasoning_graph": reasoning_graph,
        "reasoning_path": list(reasoning_graph.get("highlighted_labels") or []),
        "used_modules": [
            str(item.get("action") or item.get("key") or "")
            for item in module_trace
            if str(item.get("action") or item.get("key") or "").strip()
        ],
        "module_trace": module_trace,
        "final_score": round(final_score * 100),
        "llm_used": bool(text_payload),
        "semantic_rule_used": bool(
            isinstance((text_skill or {}).get("raw"), dict)
            and ((text_skill or {}).get("raw") or {}).get("semantic_rule_used")
        ),
        "semantic_rule_model": (
            (((text_skill or {}).get("raw") or {}).get("result_payload") or {}).get("result_detail", {}).get("semantic_rule_model")
            if text_payload
            else None
        ),
        "risk_evidence": [str(item.get("title") or "") for item in evidence[:8] if str(item.get("title") or "").strip()],
        "counter_evidence": [
            str(item.get("reason") or "").strip()
            for item in counter_evidence[:4]
            if isinstance(item, dict) and str(item.get("reason") or "").strip()
        ],
        "qr_analysis": qr_analysis,
        "advice_synthesis_mode": advice_bundle.get("synthesis_mode"),
        "advice_synthesis_rationale": advice_bundle.get("synthesis_rationale"),
        "advice_llm_model": advice_bundle.get("llm_model"),
        "advice_adopted_sources": list(advice_bundle.get("adopted_sources") or []),
        "raw_recommendation_candidates": list(advice_bundle.get("raw_candidates") or []),
        "filtered_recommendation_candidates": list(advice_bundle.get("filtered_candidates") or []),
        "similar_images": similar_images,
        "similar_images_count": len(similar_images),
        "supervisor_notes": list(state.get("routing_notes") or []),
        "planner_notes": list(state.get("planner_notes") or []),
        "unsupported_modalities": unsupported,
        "agent_loop": {
            "iteration_count": state.get("iteration_count"),
            "max_iterations": state.get("max_iterations"),
            "pending_actions": list(state.get("pending_actions") or []),
            "completed_actions": list(state.get("completed_actions") or []),
            "requires_followup": bool(followup_actions),
            "followup_actions": followup_actions,
            "stop_reason": followup_stop_reason,
        },
        "branches": {
            "text_rag_result": text_skill,
            "qr_result": state.get("qr_result"),
            "ocr_result": state.get("ocr_result"),
            "pii_result": state.get("pii_result"),
            "official_document_result": state.get("official_document_result"),
            "impersonation_result": state.get("impersonation_result"),
            "image_similarity_result": state.get("image_similarity_result"),
            "document_review_result": state.get("document_review_result"),
            "conflict_resolution_result": state.get("conflict_resolution_result"),
            "video_ai_result": state.get("video_ai_result"),
            "video_deception_result": state.get("video_deception_result"),
        },
    }

    if video_ai_summary or video_deception_summary:
        result_detail["video_ai_items"] = video_ai_items + video_ai_failed_items
        result_detail["video_ai_summary"] = video_ai_summary
        result_detail["video_deception_items"] = video_deception_items + video_deception_failed_items
        result_detail["video_deception_summary"] = video_deception_summary
        result_detail["video_analysis_modules"] = _build_video_analysis_modules(
            video_ai_summary=video_ai_summary,
            video_deception_summary=video_deception_summary,
        )

    return {
        "_trace_action_name": trace_action_name,
        "_trace_summary": summary,
        "_trace_detail_line": final_reason,
        "_trace_tags": [
            risk_level,
            fraud_type or "最终判定",
            *([f"{round(final_score * 100)} 分"] if final_score > 0 else []),
        ],
        "_trace_metrics": [
            {"label": "风险评分", "value": round(final_score * 100)},
            {"label": "线索", "value": len(evidence)},
            *([{"label": "建议", "value": len(advice)}] if advice else []),
        ],
        "summary_result": {
            "status": "completed",
            "risk_level": risk_level,
            "fraud_type": fraud_type,
            "summary": summary,
            "final_reason": final_reason,
            "confidence": round(confidence, 4),
            "is_fraud": risk_level in {"medium", "high"},
            "risk_score": round(final_score, 4),
            "need_manual_review": need_manual_review or bool(followup_actions),
            "stage_tags": stage_tags,
            "hit_rules": hit_rules,
            "rule_hits": rule_hits,
            "extracted_entities": extracted_entities,
            "input_highlights": input_highlights,
            "retrieved_evidence": retrieved_evidence,
            "counter_evidence": counter_evidence,
            "advice": advice,
            "risk_labels": risk_labels,
            "skills_triggered": skills,
            "evidence": evidence,
            "recommendations": recommendations,
            "llm_model": llm_model,
            "result_detail": result_detail,
            "rule_score": ((((text_skill or {}).get("raw") or {}).get("rule_score")) if text_skill else round(final_score * 100)),
            "retrieval_query": ((((text_skill or {}).get("raw") or {}).get("retrieval_query")) if text_skill else None),
        },
        "requires_followup": bool(followup_actions),
        "followup_actions": followup_actions,
        "stop_reason": followup_stop_reason,
    }
