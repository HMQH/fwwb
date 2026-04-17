"""LLM 语义规则评分：避免把“不要给验证码”误判成“索要验证码”."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.domain.detection import prompts, rules
from app.domain.detection.llm import ChatJsonClient, ChatJsonResult

_SIGNAL_LABELS = rules.signal_labels()
_RULE_MAP = rules.rule_map()
_SOFT_SIGNAL_KEYS = tuple(_SIGNAL_LABELS.keys())


@dataclass(slots=True)
class SemanticRuleAnalysisResult:
    rule_analysis: rules.RuleAnalysis
    model_name: str
    payload: dict[str, Any]
    raw_content: str


def _clip01(value: Any, *, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return round(max(0.0, min(1.0, number)), 4)


def _clip_score(value: Any, *, default: int) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(100, round(number)))


def _normalize_string_list(value: Any, *, limit: int = 4) -> list[str]:
    if not isinstance(value, list):
        return []
    return rules.dedupe_strings([str(item).strip() for item in value if str(item).strip()])[:limit]


def _normalize_short_list(value: Any, *, limit: int = 4) -> list[str]:
    return [item[:16].strip() for item in _normalize_string_list(value, limit=limit) if item[:16].strip()]


def _normalize_highlights(
    value: Any,
    *,
    text: str,
    lexical_analysis: rules.RuleAnalysis,
) -> list[dict[str, str]]:
    highlights: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            fragment = str(item.get("text") or "").strip()
            reason = str(item.get("reason") or "").strip()
            if not fragment or fragment not in text:
                continue
            highlights.append({"text": fragment, "reason": reason or "语义规则命中"})
    highlights.extend(lexical_analysis.input_highlights)
    return rules.dedupe_highlights(highlights)[:8]


def _normalize_soft_signals(
    value: Any,
    *,
    lexical_analysis: rules.RuleAnalysis,
) -> dict[str, float]:
    raw = value if isinstance(value, dict) else {}
    signals: dict[str, float] = {}
    for key in _SOFT_SIGNAL_KEYS:
        fallback = float(lexical_analysis.soft_signals.get(key, 0.0))
        if key in raw:
            signals[key] = _clip01(raw.get(key), default=fallback)
        else:
            signals[key] = rules.clip_signal(fallback)
    signals["action_density"] = _derive_action_density(signals)
    signals["entity_risk"] = _clip01(
        raw.get("entity_risk"),
        default=float(lexical_analysis.soft_signals.get("entity_risk", 0.0)),
    )
    return signals


def _derive_action_density(soft_signals: dict[str, float]) -> float:
    action_keys = set(rules.action_signal_keys())
    action_count = sum(1 for key in action_keys if float(soft_signals.get(key, 0.0)) >= 0.34)
    combo_bonus = 1 if soft_signals.get("credential_request", 0.0) >= 0.52 and (
        soft_signals.get("download_redirect", 0.0) >= 0.42
        or soft_signals.get("transfer_request", 0.0) >= 0.42
        or soft_signals.get("remote_control", 0.0) >= 0.42
    ) else 0
    negation_safety = float(soft_signals.get("negation_safety", 0.0))
    return rules.clip_signal(action_count * 0.22 + combo_bonus * 0.18 - negation_safety * 0.1)


def _normalize_rule_hit_payload(
    value: Any,
    *,
    text: str,
    lexical_analysis: rules.RuleAnalysis,
    soft_signals: dict[str, float],
) -> tuple[list[rules.RuleHit], dict[str, float]]:
    lexical_by_name = {item.name: item for item in lexical_analysis.rule_hits}
    semantic_strengths: dict[str, float] = {}
    result: list[rules.RuleHit] = []

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if name not in _RULE_MAP:
                continue
            rule_def = _RULE_MAP[name]
            strength = _clip01(
                item.get("score"),
                default=float(soft_signals.get(rule_def.signal_key, 0.0)),
            )
            if strength <= 0.08:
                continue
            semantic_strengths[name] = max(semantic_strengths.get(name, 0.0), strength)
            matched_texts: list[str] = []
            raw_matched = item.get("matched_texts")
            if isinstance(raw_matched, list):
                for fragment in raw_matched:
                    text_fragment = str(fragment).strip()
                    if text_fragment and text_fragment in text:
                        matched_texts.append(text_fragment)
            if not matched_texts and name in lexical_by_name:
                matched_texts.extend(
                    [fragment for fragment in lexical_by_name[name].matched_texts if fragment in text][:2]
                )
            result.append(
                rules.RuleHit(
                    name=name,
                    category=rule_def.category,
                    risk_points=rule_def.risk_points,
                    explanation=str(item.get("reason") or "").strip() or rule_def.explanation,
                    matched_texts=rules.dedupe_strings(matched_texts)[:3],
                    stage_tag=rule_def.stage_tag,
                    fraud_type_hint=rule_def.fraud_type_hint,
                )
            )

    return result, semantic_strengths


def _apply_hit_rule_fallbacks(
    *,
    payload: dict[str, Any],
    rule_hits: list[rules.RuleHit],
    semantic_strengths: dict[str, float],
    soft_signals: dict[str, float],
) -> tuple[list[rules.RuleHit], dict[str, float]]:
    existing = {item.name for item in rule_hits}
    for name in _normalize_string_list(payload.get("hit_rules"), limit=8):
        if name not in _RULE_MAP or name in existing:
            continue
        rule_def = _RULE_MAP[name]
        strength = _clip01(soft_signals.get(rule_def.signal_key, 0.0), default=0.0)
        if strength <= 0.08:
            continue
        semantic_strengths[name] = max(semantic_strengths.get(name, 0.0), strength)
        rule_hits.append(
            rules.RuleHit(
                name=name,
                category=rule_def.category,
                risk_points=rule_def.risk_points,
                explanation=rule_def.explanation,
                matched_texts=[],
                stage_tag=rule_def.stage_tag,
                fraud_type_hint=rule_def.fraud_type_hint,
            )
        )
    return rule_hits, semantic_strengths


def _derive_visible_hits(
    *,
    rule_hits: list[rules.RuleHit],
    soft_signals: dict[str, float],
) -> list[rules.RuleHit]:
    visible_threshold = 0.45 if (
        soft_signals.get("anti_fraud_context", 0.0) >= 0.55
        or soft_signals.get("negation_safety", 0.0) >= 0.45
    ) else 0.28
    return [
        hit
        for hit in rule_hits
        if float(soft_signals.get(_RULE_MAP[hit.name].signal_key, 0.0)) >= visible_threshold
    ]


def _fallback_risk_evidence(soft_signals: dict[str, float]) -> list[str]:
    items = sorted(
        (
            (signal_key, float(score))
            for signal_key, score in soft_signals.items()
            if signal_key not in {"anti_fraud_context", "negation_safety", "official_verification_guidance"}
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    return [
        _SIGNAL_LABELS.get(signal_key, signal_key)[:8]
        for signal_key, score in items
        if score >= 0.42
    ][:3]


def _fallback_counter_evidence(soft_signals: dict[str, float]) -> list[str]:
    evidence: list[str] = []
    if soft_signals.get("negation_safety", 0.0) >= 0.42:
        evidence.append("明确劝阻操作")
    if soft_signals.get("anti_fraud_context", 0.0) >= 0.42:
        evidence.append("反诈提醒语境")
    if soft_signals.get("official_verification_guidance", 0.0) >= 0.42:
        evidence.append("建议官方核实")
    return evidence[:3]


def _merge_stage_tags(
    value: Any,
    *,
    visible_hits: list[rules.RuleHit],
) -> list[str]:
    provided = _normalize_string_list(value, limit=8)
    from_hits = [item.stage_tag for item in visible_hits if item.stage_tag]
    return rules.dedupe_strings([*provided, *from_hits])


def _merge_fraud_types(
    value: Any,
    *,
    visible_hits: list[rules.RuleHit],
) -> list[str]:
    provided = _normalize_string_list(value, limit=8)
    from_hits = [item.fraud_type_hint for item in visible_hits if item.fraud_type_hint]
    return rules.dedupe_strings([*provided, *from_hits])


def _score_breakdown(
    *,
    lexical_analysis: rules.RuleAnalysis,
    semantic_rule_score: int,
    semantic_strengths: dict[str, float],
    soft_signals: dict[str, float],
) -> dict[str, Any]:
    dominant_signals = [
        _SIGNAL_LABELS.get(signal_key, signal_key)
        for signal_key, score in soft_signals.items()
        if float(score) >= 0.55
    ]
    return {
        "lexical_rule_score": lexical_analysis.rule_score,
        "semantic_rule_score": semantic_rule_score,
        "semantic_rule_strengths": {
            key: round(value, 4)
            for key, value in sorted(semantic_strengths.items(), key=lambda item: item[1], reverse=True)
        },
        "dominant_signals": dominant_signals[:6],
        "semantic_rule_used": True,
    }


def analyze_with_llm(
    client: ChatJsonClient,
    *,
    text: str,
    lexical_analysis: rules.RuleAnalysis,
) -> SemanticRuleAnalysisResult:
    system_prompt, user_prompt = prompts.build_semantic_rule_prompts(
        text=text,
        lexical_analysis=lexical_analysis,
        rule_catalog=rules.build_rule_catalog(),
    )
    llm_result: ChatJsonResult = client.complete_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        output_schema=prompts.semantic_rule_output_json_schema(),
        schema_name="semantic_rule_analysis",
    )
    payload = llm_result.payload if isinstance(llm_result.payload, dict) else {}

    soft_signals = _normalize_soft_signals(payload.get("soft_signals"), lexical_analysis=lexical_analysis)
    semantic_hits, semantic_strengths = _normalize_rule_hit_payload(
        payload.get("rule_hits"),
        text=text,
        lexical_analysis=lexical_analysis,
        soft_signals=soft_signals,
    )
    semantic_hits, semantic_strengths = _apply_hit_rule_fallbacks(
        payload=payload,
        rule_hits=semantic_hits,
        semantic_strengths=semantic_strengths,
        soft_signals=soft_signals,
    )
    visible_hits = _derive_visible_hits(rule_hits=semantic_hits, soft_signals=soft_signals)
    hit_rules = rules.dedupe_strings([item.name for item in visible_hits])
    stage_tags = _merge_stage_tags(payload.get("stage_tags"), visible_hits=visible_hits)
    fraud_type_hints = _merge_fraud_types(payload.get("fraud_type_hints"), visible_hits=visible_hits)
    input_highlights = _normalize_highlights(
        payload.get("input_highlights"),
        text=text,
        lexical_analysis=lexical_analysis,
    )
    search_keywords = rules.dedupe_strings(
        [
            *_normalize_string_list(payload.get("search_keywords"), limit=14),
            *rules.build_search_keywords(
                text,
                visible_hits,
                lexical_analysis.extracted_entities,
                soft_signals,
            ),
        ]
    )[:14]

    computed_rule_score, _ = rules.score_soft_signals(soft_signals)
    semantic_rule_score = _clip_score(payload.get("rule_score"), default=computed_rule_score)

    risk_evidence = _normalize_short_list(payload.get("risk_evidence"))
    if not risk_evidence:
        risk_evidence = _fallback_risk_evidence(soft_signals)
    counter_evidence = _normalize_short_list(payload.get("counter_evidence"))
    if not counter_evidence:
        counter_evidence = _fallback_counter_evidence(soft_signals)

    analysis = rules.RuleAnalysis(
        normalized_text=lexical_analysis.normalized_text,
        rule_score=semantic_rule_score,
        hit_rules=hit_rules,
        stage_tags=stage_tags,
        fraud_type_hints=fraud_type_hints,
        rule_hits=semantic_hits,
        extracted_entities=lexical_analysis.extracted_entities,
        input_highlights=input_highlights,
        search_keywords=search_keywords,
        soft_signals=soft_signals,
        score_breakdown=_score_breakdown(
            lexical_analysis=lexical_analysis,
            semantic_rule_score=semantic_rule_score,
            semantic_strengths=semantic_strengths,
            soft_signals=soft_signals,
        ),
        risk_evidence=rules.dedupe_strings(risk_evidence)[:4],
        counter_evidence=rules.dedupe_strings(counter_evidence)[:4],
        scoring_mode="semantic_llm",
    )
    return SemanticRuleAnalysisResult(
        rule_analysis=analysis,
        model_name=llm_result.model_name,
        payload=payload,
        raw_content=llm_result.raw_content,
    )
