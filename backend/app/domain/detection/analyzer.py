"""规则、检索与 LLM 融合判别分析。"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.domain.detection import llm, prompts, retrieval, rules, semantic_rules
from app.shared.core.config import settings

ProgressCallback = Callable[[str, int, dict[str, Any] | None], None]


@dataclass(slots=True)
class DetectionAnalysis:
    rule_score: int
    retrieval_query: str
    llm_model: str | None
    result_payload: dict[str, Any]


_CRITICAL_RULES = {"索要验证码", "要求转账付款", "引导下载或点击链接", "远程控制或共享屏幕"}
_UNKNOWN_FRAUD_TYPES = {"", "未知", "未分类", "待定", "不确定"}
_BAD_LLM_PHRASES = {"未知", "无法判断"}
_SIGNAL_LABELS = {
    "credential_request": "索要验证码",
    "transfer_request": "要求转账",
    "urgency_pressure": "紧急施压",
    "impersonation": "身份冒充",
    "download_redirect": "下载跳转",
    "privacy_request": "索要敏感信息",
    "remote_control": "远程控制",
    "part_time_bait": "刷单兼职",
    "investment_bait": "投资理财诱导",
    "after_sale_pretext": "退款售后诱导",
    "secrecy_isolation": "要求保密",
    "anti_fraud_context": "反诈提醒",
    "negation_safety": "明确劝阻风险操作",
    "official_verification_guidance": "建议官方核验",
    "entity_risk": "高风险实体",
    "action_density": "操作密度高",
}
_PIPELINE_TRACE = [
    ("preprocess", "清洗"),
    ("embedding", "编码"),
    ("vector_retrieval", "召回"),
    ("graph_reasoning", "图谱"),
    ("llm_reasoning", "判别"),
    ("finalize", "完成"),
]


def _emit(progress_callback: ProgressCallback | None, step: str, percent: int, detail: dict[str, Any] | None = None) -> None:
    if progress_callback is not None:
        progress_callback(step, percent, detail)


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return _unique_keep_order([str(item).strip() for item in value if str(item).strip()])


def _unique_dicts(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, Any]] = []
    for item in values:
        text = str(item.get("text", "")).strip()
        reason = str(item.get("reason", "")).strip()
        key = (text, reason)
        if not text or key in seen:
            continue
        seen.add(key)
        result.append({"text": text, "reason": reason})
    return result


def _clip_score(value: float) -> int:
    return max(0, min(100, round(value)))


def _safe_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(0.99, result))


def _safe_optional_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return _clip_score(float(value))
    except (TypeError, ValueError):
        return None


def _safe_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return default


def _score_from_risk_level(value: Any) -> int | None:
    normalized = str(value or "").strip().lower()
    if normalized == "high":
        return 85
    if normalized == "medium":
        return 58
    if normalized == "low":
        return 20
    return None


def _normalize_risk_level(value: Any, score: int) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized
    if score >= settings.detection_high_risk_threshold:
        return "high"
    if score >= settings.detection_low_risk_threshold:
        return "medium"
    return "low"


def _normalize_alignment(value: Any, default: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"black", "mixed", "white"}:
        return normalized
    return default


def _top_signal_items(rule_analysis: rules.RuleAnalysis, *, limit: int = 4) -> list[tuple[str, str, float]]:
    items = sorted(
        (
            (signal_key, score)
            for signal_key, score in rule_analysis.soft_signals.items()
            if signal_key not in {"anti_fraud_context", "negation_safety", "official_verification_guidance"}
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    result: list[tuple[str, str, float]] = []
    for signal_key, score in items:
        if score < 0.35:
            continue
        result.append((signal_key, _SIGNAL_LABELS.get(signal_key, signal_key), round(float(score), 4)))
        if len(result) >= limit:
            break
    return result


def _top_signal_labels(rule_analysis: rules.RuleAnalysis, *, limit: int = 4) -> list[str]:
    return [label for _, label, _ in _top_signal_items(rule_analysis, limit=limit)]


def _pick_fraud_type(
    llm_payload: dict[str, Any],
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
) -> str:
    value = str(llm_payload.get("fraud_type") or "").strip()
    if value not in _UNKNOWN_FRAUD_TYPES:
        return value
    if rule_analysis.fraud_type_hints:
        return rule_analysis.fraud_type_hints[0]
    for hit in retrieval_bundle.black_hits:
        if hit.fraud_type:
            return hit.fraud_type
    return "待定"


def _fallback_summary(
    risk_level: str,
    fraud_type: str,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
) -> str:
    safety_context = rule_analysis.soft_signals.get("anti_fraud_context", 0.0)
    negation_safety = rule_analysis.soft_signals.get("negation_safety", 0.0)
    risk_basis = "、".join(rule_analysis.risk_evidence[:2])
    counter_basis = "、".join(rule_analysis.counter_evidence[:2])
    if safety_context >= 0.55 and negation_safety >= 0.4:
        return "文本更像反诈提醒或风险提示，而不是诱导执行操作的诈骗话术。"
    if risk_level == "high":
        return f"文本出现{risk_basis or fraud_type}等高危信号，建议按高风险处理。"
    if risk_level == "medium":
        return f"文本出现{risk_basis or fraud_type}等可疑线索，仍需结合上下文继续核验。"
    if retrieval_bundle.features.evidence_alignment == "white":
        return f"当前文本更像正常提醒、通知或说明{('，主要降险点为' + counter_basis) if counter_basis else ''}。"
    if rule_analysis.hit_rules:
        return f"文本触发了多项风险信号{('，但同时存在' + counter_basis) if counter_basis else ''}，建议保持警惕并通过官方渠道核实。"
    return "暂未发现足够高风险证据，但仍建议不要直接执行对方要求。"


def _fallback_advice(rule_analysis: rules.RuleAnalysis, risk_level: str) -> list[str]:
    advice: list[str] = []
    signals = rule_analysis.soft_signals
    if signals.get("credential_request", 0.0) >= 0.42 or signals.get("privacy_request", 0.0) >= 0.42:
        advice.append("不要提供验证码、密码、银行卡号、身份证号等敏感信息。")
    if signals.get("transfer_request", 0.0) >= 0.42 or signals.get("remote_control", 0.0) >= 0.42:
        advice.append("不要转账、共享屏幕，也不要按要求开启远程协助。")
    if signals.get("download_redirect", 0.0) >= 0.42:
        advice.append("不要点击陌生链接或下载来源不明的 APP。")
    if risk_level != "low":
        advice.append("通过官方电话、官方 App 或线下网点进行二次核验。")
        advice.append("保留聊天记录、链接、账号与转账信息，必要时及时报警。")
    if signals.get("anti_fraud_context", 0.0) >= 0.48 and not advice:
        advice.append("若内容本身是反诈提醒，请结合官方来源继续核实真伪。")
    if not advice:
        advice.append("如需继续处理，请先核实身份与渠道，再决定是否操作。")
    return _unique_keep_order(advice)[:4]


def _build_fallback_reason(
    *,
    fraud_type: str,
    risk_level: str,
    final_score: int,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    score_breakdown: dict[str, Any],
) -> str:
    top_signals = "、".join(rule_analysis.risk_evidence[:3] or _top_signal_labels(rule_analysis)) or "暂无明显信号"
    counter_signals = "、".join(rule_analysis.counter_evidence[:3])
    features = retrieval_bundle.features
    alignment_text = {
        "black": "历史风险案例更接近",
        "white": "历史安全表达更接近",
        "mixed": "风险案例与安全表达同时接近",
    }.get(features.evidence_alignment, "检索结果有限")
    parts = [f"可疑依据：{top_signals}。"]
    if counter_signals:
        parts.append(f"降险依据：{counter_signals}。")
    parts.append(
        f"检索侧表现为{alignment_text}，风险侧 top1 {features.black_top1:.2f}，安全侧 top1 {features.white_top1:.2f}。"
    )
    parts.append(
        "融合评分："
        f"规则 {score_breakdown['rule_score']}，检索 {score_breakdown['retrieval_score']}"
        + (
            f"，LLM {score_breakdown['llm_score']}"
            if score_breakdown.get("llm_score") is not None
            else ""
        )
        + f"，最终 {final_score}。"
    )
    parts.append(f"综合判断当前风险等级为{_risk_label(risk_level)}，诈骗类型倾向{fraud_type}。")
    return "".join(parts)


def _normalize_highlights(
    llm_payload: dict[str, Any],
    rule_analysis: rules.RuleAnalysis,
) -> list[dict[str, str]]:
    highlights: list[dict[str, Any]] = []
    raw = llm_payload.get("input_highlights")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                highlights.append(
                    {
                        "text": str(item.get("text") or "").strip(),
                        "reason": str(item.get("reason") or "").strip(),
                    }
                )
    highlights.extend(rule_analysis.input_highlights)
    return _unique_dicts(highlights)[:8]


def _looks_bad_llm_text(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return True
    return any(bad in normalized for bad in _BAD_LLM_PHRASES)


def _derive_llm_score(
    llm_payload: dict[str, Any],
    *,
    fallback_score: int,
) -> int | None:
    direct_score = _safe_optional_int(llm_payload.get("risk_score"))
    if direct_score is not None:
        return direct_score
    level_score = _score_from_risk_level(llm_payload.get("risk_level"))
    if level_score is not None:
        return level_score
    if llm_payload:
        return fallback_score
    return None


def _normalize_weights(has_llm: bool) -> dict[str, float]:
    weights = {
        "rule": max(0.0, settings.detection_fusion_rule_weight),
        "retrieval": max(0.0, settings.detection_fusion_retrieval_weight),
        "llm": max(0.0, settings.detection_fusion_llm_weight if has_llm else 0.0),
    }
    total = sum(weights.values()) or 1.0
    return {key: round(value / total, 4) for key, value in weights.items() if value > 0}


def _fuse_scores(
    *,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    llm_payload: dict[str, Any],
) -> dict[str, Any]:
    rule_score = rule_analysis.rule_score
    retrieval_score = retrieval_bundle.features.retrieval_score
    llm_fallback = _clip_score(rule_score * 0.55 + retrieval_score * 0.45)
    llm_score = _derive_llm_score(llm_payload, fallback_score=llm_fallback)
    weights = _normalize_weights(has_llm=llm_score is not None)

    base_score = rule_score * weights.get("rule", 0.0) + retrieval_score * weights.get("retrieval", 0.0)
    if llm_score is not None:
        base_score += llm_score * weights.get("llm", 0.0)

    component_scores = [rule_score, retrieval_score]
    if llm_score is not None:
        component_scores.append(llm_score)
    spread = max(component_scores) - min(component_scores)
    agreement_bonus = 5 if spread <= 12 else 3 if spread <= 22 else 0

    critical_combo = (
        rule_analysis.soft_signals.get("credential_request", 0.0) >= 0.58
        and (
            rule_analysis.soft_signals.get("download_redirect", 0.0) >= 0.45
            or rule_analysis.soft_signals.get("transfer_request", 0.0) >= 0.45
            or rule_analysis.soft_signals.get("remote_control", 0.0) >= 0.45
        )
    )
    critical_bonus = 6 if critical_combo else 0

    features = retrieval_bundle.features
    if features.evidence_alignment == "black" and (
        features.similarity_gap_top1 >= 0.14 or features.similarity_gap_avg3 >= 0.08
    ):
        alignment_bonus = 4
    elif features.evidence_alignment == "mixed":
        alignment_bonus = 1
    else:
        alignment_bonus = 0

    safety_penalty = round(
        rule_analysis.soft_signals.get("anti_fraud_context", 0.0) * 7
        + rule_analysis.soft_signals.get("negation_safety", 0.0) * 10
        + rule_analysis.soft_signals.get("official_verification_guidance", 0.0) * 4
    )
    if features.evidence_alignment == "white":
        safety_penalty += 6
    elif features.evidence_alignment == "mixed":
        safety_penalty += 2

    llm_safety_signals = _normalize_string_list(llm_payload.get("safety_signals"))
    negative_evidence = _normalize_string_list(llm_payload.get("negative_evidence"))
    safety_penalty += min(len(llm_safety_signals), 2) * 2
    safety_penalty += min(len(negative_evidence), 2) * 2

    final_score = _clip_score(base_score + agreement_bonus + critical_bonus + alignment_bonus - safety_penalty)
    return {
        "rule_score": rule_score,
        "retrieval_score": retrieval_score,
        "llm_score": llm_score,
        "base_score": round(base_score, 2),
        "agreement_spread": spread,
        "agreement_bonus": agreement_bonus,
        "critical_bonus": critical_bonus,
        "alignment_bonus": alignment_bonus,
        "safety_penalty": safety_penalty,
        "final_score": final_score,
        "weights": weights,
        "evidence_alignment": _normalize_alignment(
            llm_payload.get("evidence_alignment"),
            features.evidence_alignment,
        ),
        "llm_safety_signals": llm_safety_signals,
        "negative_evidence": negative_evidence,
    }


def _stabilize_risk_level(
    *,
    risk_level: str,
    final_score: int,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
) -> str:
    critical_count = len([name for name in rule_analysis.hit_rules if name in _CRITICAL_RULES])
    if final_score >= settings.detection_high_risk_threshold and critical_count >= 2:
        return "high"
    if "索要验证码" in rule_analysis.hit_rules and (
        "引导下载或点击链接" in rule_analysis.hit_rules or "要求转账付款" in rule_analysis.hit_rules
    ):
        return "high"
    if (
        rule_analysis.soft_signals.get("anti_fraud_context", 0.0) >= 0.68
        and rule_analysis.soft_signals.get("negation_safety", 0.0) >= 0.55
        and retrieval_bundle.features.evidence_alignment == "white"
    ):
        return "low"
    if (
        final_score < settings.detection_low_risk_threshold
        and retrieval_bundle.features.white_support_count > retrieval_bundle.features.black_support_count
    ):
        return "low"
    return risk_level


def _risk_label(value: str | None) -> str:
    return {"high": "高风险", "medium": "需核验", "low": "低风险"}.get(str(value or "").lower(), "待定")


def _build_module_trace(
    *,
    llm_used: bool,
    semantic_rule_used: bool,
    signal_count: int,
    black_count: int,
    white_count: int,
) -> list[dict[str, Any]]:
    metrics = {
        "preprocess": {"text": "1"},
        "embedding": {"text": "1", "semantic": 1 if semantic_rule_used else 0},
        "vector_retrieval": {"black": black_count, "white": white_count},
        "graph_reasoning": {"signals": signal_count},
        "llm_reasoning": {"llm": 1 if llm_used else 0},
        "finalize": {"done": 1},
    }
    result: list[dict[str, Any]] = []
    for key, label in _PIPELINE_TRACE:
        result.append(
            {
                "key": key,
                "label": label,
                "status": "completed",
                "metrics": metrics.get(key, {}),
                "enabled": False if key == "llm_reasoning" and not llm_used else True,
            }
        )
    return result


def _compact_graph_label(value: str | None, fallback: str, *, limit: int = 10) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return fallback
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip("，。、；： ") + "…"


def _build_black_support_label(black_evidence: list[dict[str, Any]]) -> str:
    if not black_evidence:
        return "接近风险案例"
    fraud_type = str(black_evidence[0].get("fraud_type") or "").strip()
    if fraud_type and fraud_type not in _UNKNOWN_FRAUD_TYPES:
        return _compact_graph_label(f"接近{fraud_type}", "接近风险案例")
    return "接近风险案例"


def _build_white_support_label(
    white_evidence: list[dict[str, Any]],
    rule_analysis: rules.RuleAnalysis,
) -> str:
    if rule_analysis.soft_signals.get("anti_fraud_context", 0.0) >= 0.46:
        return "更像反诈提醒"
    if rule_analysis.soft_signals.get("official_verification_guidance", 0.0) >= 0.46:
        return "建议官方核实"
    if white_evidence:
        return "接近正常说明"
    return "安全支持"


def _build_reasoning_graph(
    *,
    rule_analysis: rules.RuleAnalysis,
    black_evidence: list[dict[str, Any]],
    white_evidence: list[dict[str, Any]],
    fraud_type: str | None,
    risk_level: str | None,
    final_score: int | None,
    confidence: float | None,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def add_node(
        node_id: str,
        label: str,
        *,
        kind: str,
        tone: str,
        lane: int,
        order: int,
        strength: float,
        meta: dict[str, Any] | None = None,
    ) -> None:
        nodes.append(
            {
                "id": node_id,
                "label": _compact_graph_label(label, "节点"),
                "kind": kind,
                "tone": tone,
                "lane": lane,
                "order": order,
                "strength": round(max(0.0, min(1.0, strength)), 4),
                "meta": meta or {},
            }
        )

    def add_edge(
        edge_id: str,
        source: str,
        target: str,
        *,
        tone: str,
        kind: str,
        weight: float,
    ) -> None:
        edges.append(
            {
                "id": edge_id,
                "source": source,
                "target": target,
                "tone": tone,
                "kind": kind,
                "weight": round(max(0.0, min(1.0, weight)), 4),
            }
        )

    add_node("input", "原文", kind="input", tone="primary", lane=0, order=0, strength=0.76)

    risk_signal_scores = [score for _, _, score in _top_signal_items(rule_analysis, limit=4)]
    safety_strength = max(
        rule_analysis.soft_signals.get("anti_fraud_context", 0.0),
        rule_analysis.soft_signals.get("negation_safety", 0.0),
        rule_analysis.soft_signals.get("official_verification_guidance", 0.0),
    )

    risk_basis = _unique_keep_order(rule_analysis.risk_evidence[:3] or _top_signal_labels(rule_analysis, limit=3))
    counter_basis = _unique_keep_order(rule_analysis.counter_evidence[:3])

    black_top_score = float(black_evidence[0].get("similarity_score") or 0.0) if black_evidence else 0.0
    white_top_score = float(white_evidence[0].get("similarity_score") or 0.0) if white_evidence else 0.0

    if black_top_score >= 0.46:
        risk_basis.append(_build_black_support_label(black_evidence))
    if white_top_score >= 0.44:
        counter_basis.append(_build_white_support_label(white_evidence, rule_analysis))

    risk_basis = _unique_keep_order(risk_basis)[:3]
    counter_basis = _unique_keep_order(counter_basis)[:3]

    risk_node_ids: list[str] = []
    counter_node_ids: list[str] = []
    for index, label in enumerate(risk_basis):
        strength = risk_signal_scores[index] if index < len(risk_signal_scores) else max(0.42, 0.64 - index * 0.08)
        node_id = f"risk_basis:{index}"
        risk_node_ids.append(node_id)
        add_node(
            node_id,
            label,
            kind="risk_basis",
            tone="danger",
            lane=1,
            order=index,
            strength=strength,
            meta={"group": "risk"},
        )
        add_edge(
            f"edge:input:risk:{index}",
            "input",
            node_id,
            tone="danger",
            kind="risk_basis",
            weight=max(0.34, strength),
        )

    for index, label in enumerate(counter_basis):
        strength = max(0.38, safety_strength - index * 0.08, white_top_score if "接近" in label or "更像" in label else 0.0)
        node_id = f"counter_basis:{index}"
        counter_node_ids.append(node_id)
        add_node(
            node_id,
            label,
            kind="counter_basis",
            tone="safe",
            lane=2,
            order=index,
            strength=strength,
            meta={"group": "counter"},
        )
        add_edge(
            f"edge:input:counter:{index}",
            "input",
            node_id,
            tone="safe",
            kind="counter_basis",
            weight=max(0.3, strength),
        )

    risk_node_label = _risk_label(risk_level)
    risk_strength = (final_score or 0) / 100 if final_score is not None else 0.5
    risk_tone = (
        "danger" if str(risk_level or "").lower() == "high"
        else "warning" if str(risk_level or "").lower() == "medium"
        else "safe"
    )
    add_node(
        "risk_level",
        risk_node_label,
        kind="risk",
        tone=risk_tone,
        lane=3,
        order=0,
        strength=risk_strength,
        meta={
            "final_score": final_score,
            "confidence": confidence,
            "fraud_type": fraud_type,
        },
    )

    node_lookup = {str(item["id"]): item for item in nodes}

    for node_id in risk_node_ids:
        node = node_lookup.get(node_id)
        weight = float(node["strength"]) if node else 0.52
        add_edge(
            f"edge:{node_id}:risk",
            node_id,
            "risk_level",
            tone="danger",
            kind="decision_support",
            weight=max(0.34, weight),
        )

    for node_id in counter_node_ids:
        node = next((item for item in nodes if item["id"] == node_id), None)
        weight = float(node["strength"]) if node else 0.48
        add_edge(
            f"edge:{node_id}:risk",
            node_id,
            "risk_level",
            tone="safe",
            kind="decision_balance",
            weight=max(0.3, weight),
        )

    if str(risk_level or "").lower() == "low" and counter_node_ids:
        highlighted_path = ["input", counter_node_ids[0], "risk_level"]
    elif risk_node_ids:
        highlighted_path = ["input", risk_node_ids[0], "risk_level"]
    elif counter_node_ids:
        highlighted_path = ["input", counter_node_ids[0], "risk_level"]
    else:
        highlighted_path = ["input", "risk_level"]

    label_lookup = {str(node["id"]): str(node["label"]) for node in nodes}
    return {
        "nodes": nodes,
        "edges": edges,
        "highlighted_path": highlighted_path,
        "highlighted_labels": [label_lookup[node_id] for node_id in highlighted_path if node_id in label_lookup],
        "lane_labels": ["原文", "可疑", "降险", "结论"],
        "summary_metrics": {
            "risk_basis_count": len(risk_basis),
            "counter_basis_count": len(counter_basis),
            "black_count": len(black_evidence),
            "white_count": len(white_evidence),
            "final_score": final_score,
            "confidence": confidence,
        },
    }


def analyze_text_submission(
    db: Session,
    *,
    text: str,
    progress_callback: ProgressCallback | None = None,
) -> DetectionAnalysis:
    normalized_text = rules.normalize_text(text)
    _emit(
        progress_callback,
        "preprocess",
        12,
        {
            "text_length": len(normalized_text),
            "line_count": len([line for line in normalized_text.splitlines() if line.strip()]),
        },
    )

    lexical_rule_analysis = rules.analyze_text(normalized_text)
    rule_analysis = lexical_rule_analysis
    semantic_rule_payload: dict[str, Any] = {}
    semantic_rule_model: str | None = None
    semantic_rule_used = False
    client: llm.ChatJsonClient | None = None
    try:
        client = llm.build_chat_json_client()
        semantic_result = semantic_rules.analyze_with_llm(
            client,
            text=normalized_text,
            lexical_analysis=lexical_rule_analysis,
        )
        rule_analysis = semantic_result.rule_analysis
        semantic_rule_payload = semantic_result.payload
        semantic_rule_model = semantic_result.model_name
        semantic_rule_used = True
    except Exception:
        rule_analysis = lexical_rule_analysis
        semantic_rule_payload = {}
        semantic_rule_model = None
        semantic_rule_used = False

    _emit(
        progress_callback,
        "embedding",
        28,
        {
            "rule_score": rule_analysis.rule_score,
            "lexical_rule_score": lexical_rule_analysis.rule_score,
            "keyword_count": len(rule_analysis.search_keywords),
            "hit_rule_count": len(rule_analysis.hit_rules),
            "semantic_rule_used": semantic_rule_used,
            "scoring_mode": rule_analysis.scoring_mode,
        },
    )

    retrieval_bundle = retrieval.retrieve_text_evidence(db, text=normalized_text, rule_analysis=rule_analysis)
    black_evidence = [retrieval.format_evidence(hit) for hit in retrieval_bundle.black_hits]
    white_evidence = [retrieval.format_evidence(hit) for hit in retrieval_bundle.white_hits]
    _emit(
        progress_callback,
        "vector_retrieval",
        52,
        {
            "query_text": retrieval_bundle.query_text,
            "black_hits": len(black_evidence),
            "white_hits": len(white_evidence),
            "evidence_alignment": retrieval_bundle.features.evidence_alignment,
        },
    )

    graph_preview = _build_reasoning_graph(
        rule_analysis=rule_analysis,
        black_evidence=black_evidence,
        white_evidence=white_evidence,
        fraud_type=rule_analysis.fraud_type_hints[0] if rule_analysis.fraud_type_hints else None,
        risk_level=None,
        final_score=None,
        confidence=None,
    )
    _emit(
        progress_callback,
        "graph_reasoning",
        72,
        {
            "reasoning_graph": graph_preview,
            "signal_count": len(_top_signal_items(rule_analysis)),
            "black_hits": len(black_evidence),
            "white_hits": len(white_evidence),
        },
    )

    llm_payload: dict[str, Any] = {}
    llm_model: str | None = None
    llm_used = False
    try:
        system_prompt, user_prompt = prompts.build_detection_prompts(
            text=normalized_text,
            rule_analysis=rule_analysis,
            retrieval=retrieval_bundle,
        )
        if client is None:
            client = llm.build_chat_json_client()
        llm_result = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        llm_payload = llm_result.payload
        llm_model = llm_result.model_name
        llm_used = True
    except Exception:
        llm_payload = {}
        llm_model = None
        llm_used = False

    _emit(
        progress_callback,
        "llm_reasoning",
        86,
        {
            "llm_used": llm_used,
            "llm_model": llm_model,
            "fallback": not llm_used,
        },
    )

    score_breakdown = _fuse_scores(
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
        llm_payload=llm_payload,
    )
    final_score = int(score_breakdown["final_score"])

    risk_level = _normalize_risk_level(llm_payload.get("risk_level"), final_score)
    risk_level = _stabilize_risk_level(
        risk_level=risk_level,
        final_score=final_score,
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
    )
    fraud_type = _pick_fraud_type(llm_payload, rule_analysis, retrieval_bundle)
    is_fraud_default = risk_level in {"medium", "high"}
    is_fraud = _safe_bool(llm_payload.get("is_fraud"), is_fraud_default)

    component_scores = [
        score_breakdown["rule_score"],
        score_breakdown["retrieval_score"],
    ]
    if score_breakdown.get("llm_score") is not None:
        component_scores.append(score_breakdown["llm_score"])
    spread = max(component_scores) - min(component_scores)
    confidence_default = min(
        0.96,
        max(
            0.24,
            0.4
            + max(0.0, 1 - spread / 70) * 0.22
            + min(retrieval_bundle.features.black_support_count, 3) * 0.04
            + (0.05 if llm_model else 0.03 if semantic_rule_model else 0.0)
            - (0.08 if retrieval_bundle.features.evidence_alignment == "mixed" else 0.0),
        ),
    )
    confidence = _safe_float(llm_payload.get("confidence"), confidence_default)

    stage_tags = _unique_keep_order(
        [
            *rule_analysis.stage_tags,
            *[
                str(item).strip()
                for item in (llm_payload.get("stage_tags") or [])
                if str(item).strip()
            ],
        ]
    )
    hit_rules = _unique_keep_order(
        [
            *rule_analysis.hit_rules,
            *[
                str(item).strip()
                for item in (llm_payload.get("hit_rules") or [])
                if str(item).strip()
            ],
        ]
    )
    input_highlights = _normalize_highlights(llm_payload, rule_analysis)
    llm_safety_signals = _unique_keep_order(
        [
            *rule_analysis.counter_evidence,
            *_normalize_string_list(llm_payload.get("safety_signals")),
        ]
    )
    risk_evidence = _unique_keep_order(rule_analysis.risk_evidence)
    negative_evidence = _unique_keep_order(
        [
            *rule_analysis.counter_evidence,
            *_normalize_string_list(llm_payload.get("negative_evidence")),
        ]
    )
    counter_evidence = _unique_keep_order([*rule_analysis.counter_evidence, *llm_safety_signals, *negative_evidence])

    raw_summary = str(llm_payload.get("summary") or "").strip()
    raw_reason = str(llm_payload.get("final_reason") or "").strip()
    summary = raw_summary if not _looks_bad_llm_text(raw_summary) else _fallback_summary(
        risk_level,
        fraud_type,
        rule_analysis,
        retrieval_bundle,
    )
    final_reason = raw_reason if not _looks_bad_llm_text(raw_reason) else _build_fallback_reason(
        fraud_type=fraud_type,
        risk_level=risk_level,
        final_score=final_score,
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
        score_breakdown=score_breakdown,
    )
    advice = _normalize_string_list(llm_payload.get("advice")) or _fallback_advice(rule_analysis, risk_level)

    need_manual_review = _safe_bool(
        llm_payload.get("need_manual_review"),
        confidence < settings.detection_manual_review_confidence_threshold
        or spread >= 28
        or retrieval_bundle.features.evidence_alignment == "mixed",
    )

    reasoning_graph = _build_reasoning_graph(
        rule_analysis=rule_analysis,
        black_evidence=black_evidence,
        white_evidence=white_evidence,
        fraud_type=fraud_type,
        risk_level=risk_level,
        final_score=final_score,
        confidence=round(confidence, 4),
    )
    module_trace = _build_module_trace(
        llm_used=llm_used,
        semantic_rule_used=semantic_rule_used,
        signal_count=len(_top_signal_items(rule_analysis)),
        black_count=len(black_evidence),
        white_count=len(white_evidence),
    )
    used_modules = [item[0] for item in _PIPELINE_TRACE if llm_used or item[0] != "llm_reasoning"]

    _emit(
        progress_callback,
        "finalize",
        96,
        {
            "final_score": final_score,
            "risk_level": risk_level,
            "fraud_type": fraud_type,
            "used_modules": used_modules,
            "semantic_rule_used": semantic_rule_used,
        },
    )

    result_payload = {
        "risk_level": risk_level,
        "fraud_type": fraud_type,
        "confidence": round(confidence, 4),
        "is_fraud": is_fraud,
        "summary": summary,
        "final_reason": final_reason,
        "need_manual_review": need_manual_review,
        "stage_tags": stage_tags,
        "hit_rules": hit_rules,
        "rule_hits": [asdict(hit) for hit in rule_analysis.rule_hits],
        "extracted_entities": rule_analysis.extracted_entities,
        "input_highlights": input_highlights,
        "retrieved_evidence": black_evidence,
        "counter_evidence": white_evidence,
        "advice": advice[:4],
        "result_detail": {
            "rule_analysis": rule_analysis.to_json(),
            "lexical_rule_analysis": lexical_rule_analysis.to_json(),
            "semantic_rule_output": semantic_rule_payload,
            "retrieval": retrieval_bundle.to_json(),
            "llm_output": llm_payload,
            "score_breakdown": score_breakdown,
            "risk_evidence": risk_evidence,
            "counter_evidence": counter_evidence,
            "safety_signals": llm_safety_signals,
            "negative_evidence": negative_evidence,
            "final_score": final_score,
            "reasoning_graph": reasoning_graph,
            "reasoning_path": list(reasoning_graph.get("highlighted_labels") or []),
            "used_modules": used_modules,
            "module_trace": module_trace,
            "semantic_rule_used": semantic_rule_used,
            "semantic_rule_model": semantic_rule_model,
            "llm_used": llm_used,
        },
    }

    return DetectionAnalysis(
        rule_score=rule_analysis.rule_score,
        retrieval_query=retrieval_bundle.query_text,
        llm_model=llm_model or semantic_rule_model,
        result_payload=result_payload,
    )
