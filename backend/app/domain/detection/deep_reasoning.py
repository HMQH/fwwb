"""反诈深度推理：阶段链、定向检索、反证约束与结构化图谱。"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domain.detection import retrieval, rules
from app.domain.rag import search as rag_search

_STAGE_BLUEPRINTS: tuple[dict[str, Any], ...] = (
    {
        "code": "hook",
        "label": "接触建链",
        "tone": "primary",
        "order": 0,
        "stage_tag": "hook",
        "signal_weights": {
            "impersonation": 0.32,
            "after_sale_pretext": 0.22,
            "part_time_bait": 0.22,
            "investment_bait": 0.24,
        },
        "entity_bonus": {"phones": 0.06},
        "keywords": ["客服", "退款", "兼职", "导师", "官方", "平台"],
    },
    {
        "code": "instruction",
        "label": "诱导操作",
        "tone": "warning",
        "order": 1,
        "stage_tag": "instruction",
        "signal_weights": {
            "download_redirect": 0.32,
            "remote_control": 0.28,
            "privacy_request": 0.18,
            "credential_request": 0.08,
        },
        "entity_bonus": {"urls": 0.16, "codes": 0.08},
        "keywords": ["链接", "下载", "安装", "验证码", "远程", "屏幕共享"],
    },
    {
        "code": "pressure",
        "label": "施压锁定",
        "tone": "warning",
        "order": 2,
        "stage_tag": "pressure",
        "signal_weights": {
            "urgency_pressure": 0.38,
            "secrecy_isolation": 0.24,
            "impersonation": 0.08,
        },
        "entity_bonus": {},
        "keywords": ["立即", "马上", "冻结", "过时", "保密", "不要告诉"],
    },
    {
        "code": "payment",
        "label": "资金收口",
        "tone": "danger",
        "order": 3,
        "stage_tag": "payment",
        "signal_weights": {
            "transfer_request": 0.34,
            "credential_request": 0.28,
            "remote_control": 0.1,
            "privacy_request": 0.08,
        },
        "entity_bonus": {"money": 0.16, "codes": 0.12},
        "keywords": ["转账", "汇款", "付款", "验证码", "银行卡", "充值"],
    },
    {
        "code": "cover_up",
        "label": "隔离断联",
        "tone": "danger",
        "order": 4,
        "stage_tag": "cover_up",
        "signal_weights": {
            "secrecy_isolation": 0.34,
            "urgency_pressure": 0.12,
        },
        "entity_bonus": {},
        "keywords": ["保密", "不要报警", "不要告诉", "私下处理"],
    },
)

_SAFE_STAGE = {
    "code": "guard",
    "label": "官方核验",
    "tone": "safe",
}

_SIGNAL_LABELS = {
    "impersonation": "冒充身份",
    "after_sale_pretext": "售后退款",
    "part_time_bait": "兼职刷单",
    "investment_bait": "投资诱导",
    "download_redirect": "链接下载",
    "remote_control": "远程控制",
    "privacy_request": "索要敏感信息",
    "credential_request": "索要验证码",
    "urgency_pressure": "紧急施压",
    "secrecy_isolation": "切断核验",
    "transfer_request": "转账付款",
    "anti_fraud_context": "反诈提醒",
    "negation_safety": "明确劝阻",
    "official_verification_guidance": "建议官方核实",
}

_RISK_LABELS = {
    "high": "高风险",
    "medium": "需核验",
    "low": "低风险",
}


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _clamp01(value: float) -> float:
    return round(max(0.0, min(0.99, float(value))), 4)


def _clamp100(value: float) -> int:
    return max(0, min(100, round(float(value))))


def _snippet(value: Any, *, limit: int = 54) -> str:
    normalized = str(value or "").strip().replace("\n", " ")
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip("，。、；： ") + "…"


def _entity_label(entity_key: str, value: str, index: int) -> str:
    raw = str(value or "").strip()
    if entity_key == "phones":
        digits = "".join(ch for ch in raw if ch.isdigit())
        tail = digits[-4:] if digits else ""
        return f"号码{tail}" if tail else "号码"
    if entity_key == "money":
        return _snippet(raw, limit=6) or f"金额{index + 1}"
    if entity_key == "codes":
        digits = "".join(ch for ch in raw if ch.isdigit())
        return f"验证码{digits[-2:]}" if digits else "验证码"
    if entity_key == "urls":
        return "链接" if not raw else _snippet(raw.replace("https://", "").replace("http://", ""), limit=6)
    return _snippet(raw, limit=6) or f"线索{index + 1}"


def _entity_tone(entity_key: str) -> str:
    if entity_key in {"money", "codes"}:
        return "danger"
    if entity_key == "urls":
        return "warning"
    return "primary"


def _safe_strength(rule_analysis: rules.RuleAnalysis, retrieval_bundle: retrieval.RetrievalBundle) -> float:
    features = retrieval_bundle.features
    return _clamp01(
        rule_analysis.soft_signals.get("anti_fraud_context", 0.0) * 0.42
        + rule_analysis.soft_signals.get("negation_safety", 0.0) * 0.36
        + rule_analysis.soft_signals.get("official_verification_guidance", 0.0) * 0.22
        + min(features.white_top1, 0.75) * 0.18
    )


def _stage_score(
    blueprint: dict[str, Any],
    *,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    safe_strength: float,
) -> float:
    score = 0.0
    for signal_key, weight in dict(blueprint.get("signal_weights") or {}).items():
        score += float(rule_analysis.soft_signals.get(signal_key, 0.0)) * float(weight)

    if str(blueprint.get("stage_tag") or "") in set(rule_analysis.stage_tags):
        score += 0.12

    entities = rule_analysis.extracted_entities or {}
    for entity_key, bonus in dict(blueprint.get("entity_bonus") or {}).items():
        if list(entities.get(entity_key) or []):
            score += float(bonus)

    black_boost = min(retrieval_bundle.features.black_top1, 0.78) * 0.16
    white_penalty = min(retrieval_bundle.features.white_top1, 0.72) * 0.12
    if str(blueprint.get("code")) in {"instruction", "payment"}:
        score += black_boost
    if str(blueprint.get("code")) in {"payment", "cover_up"}:
        score -= safe_strength * 0.08
    score -= white_penalty if retrieval_bundle.features.evidence_alignment == "white" else 0.0
    return _clamp01(score)


def _build_stage_scores(
    *,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    safe_strength: float,
) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    for blueprint in _STAGE_BLUEPRINTS:
        stages.append(
            {
                "code": blueprint["code"],
                "label": blueprint["label"],
                "tone": blueprint["tone"],
                "order": blueprint["order"],
                "score": _stage_score(
                    blueprint,
                    rule_analysis=rule_analysis,
                    retrieval_bundle=retrieval_bundle,
                    safe_strength=safe_strength,
                ),
            }
        )
    return stages


def _choose_stage_chain(
    *,
    stage_scores: list[dict[str, Any]],
    risk_level: str,
    safe_strength: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    active = [item for item in stage_scores if float(item.get("score") or 0.0) >= 0.24]
    active.sort(key=lambda item: (int(item.get("order") or 0), -float(item.get("score") or 0.0)))

    if risk_level == "low" and safe_strength >= 0.32 and (not active or float(active[-1].get("score") or 0.0) < 0.52):
        current = {
            "code": _SAFE_STAGE["code"],
            "label": _SAFE_STAGE["label"],
            "tone": _SAFE_STAGE["tone"],
            "score": safe_strength,
            "order": len(_STAGE_BLUEPRINTS),
        }
        return active[:2], current

    if not active:
        top = max(stage_scores, key=lambda item: float(item.get("score") or 0.0), default=None)
        if top is None:
            return [], {
                "code": "pending",
                "label": "待判定",
                "tone": "primary",
                "score": 0.0,
                "order": 0,
            }
        return [top], top

    return active[:4], active[-1]


def _stage_blueprint_for(code: str) -> dict[str, Any] | None:
    return next((item for item in _STAGE_BLUEPRINTS if item["code"] == code), None)


def _stage_query(
    *,
    text: str,
    stage: dict[str, Any],
    rule_analysis: rules.RuleAnalysis,
) -> tuple[str, list[str]]:
    blueprint = _stage_blueprint_for(str(stage.get("code") or "")) or {}
    ranked_signals = sorted(
        (
            (signal_key, float(rule_analysis.soft_signals.get(signal_key, 0.0)))
            for signal_key in dict(blueprint.get("signal_weights") or {}).keys()
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    signal_labels = [_SIGNAL_LABELS.get(signal_key, signal_key) for signal_key, score in ranked_signals if score >= 0.34][:4]
    parts = [_snippet(text, limit=320), f"阶段：{stage['label']}"]
    if signal_labels:
        parts.append("信号：" + "、".join(signal_labels))
    if rule_analysis.fraud_type_hints:
        parts.append("类型：" + "、".join(rule_analysis.fraud_type_hints[:2]))
    entities = rule_analysis.extracted_entities or {}
    if list(entities.get("urls") or []) and str(stage.get("code") or "") == "instruction":
        parts.append("媒介：链接")
    if list(entities.get("money") or []) and str(stage.get("code") or "") == "payment":
        parts.append("目标：资金")

    keywords = _unique_keep_order(
        [
            *list(rule_analysis.search_keywords or []),
            *list(blueprint.get("keywords") or []),
            *signal_labels,
            *_unique_keep_order(rule_analysis.fraud_type_hints),
        ]
    )[:10]
    return "\n".join(parts), keywords


def _run_stage_retrievals(
    db: Session,
    *,
    text: str,
    chain: list[dict[str, Any]],
    rule_analysis: rules.RuleAnalysis,
) -> list[dict[str, Any]]:
    stage_results: list[dict[str, Any]] = []
    for stage in chain[:4]:
        query_text, keywords = _stage_query(text=text, stage=stage, rule_analysis=rule_analysis)
        try:
            result = rag_search.search_comparative_text(
                db,
                query_text=query_text,
                keywords=keywords,
                black_top_k=2,
                white_top_k=2,
                vector_top_k=4,
                keyword_top_k=4,
            )
        except Exception:
            continue

        black_hits = [retrieval.format_evidence(item) for item in result.black_hits[:2]]
        white_hits = [retrieval.format_evidence(item) for item in result.white_hits[:2]]
        black_top = float(black_hits[0].get("similarity_score") or 0.0) if black_hits else 0.0
        white_top = float(white_hits[0].get("similarity_score") or 0.0) if white_hits else 0.0
        support_score = _clamp01(float(stage.get("score") or 0.0) * 0.46 + black_top * 0.38 - white_top * 0.24)
        stage_results.append(
            {
                "code": stage["code"],
                "label": stage["label"],
                "score": stage.get("score"),
                "support_score": support_score,
                "query_text": query_text,
                "keywords": keywords,
                "black_hits": black_hits,
                "white_hits": white_hits,
                "black_count": len(black_hits),
                "white_count": len(white_hits),
            }
        )
    return stage_results


def _merge_evidence(
    base_items: list[dict[str, Any]],
    stage_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for item in [*base_items, *stage_items]:
        key = (
            item.get("source_id"),
            item.get("chunk_index"),
            item.get("sample_label"),
            item.get("chunk_text"),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged[:8]


def _chain_metrics(
    *,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    chain: list[dict[str, Any]],
    current_stage: dict[str, Any],
    stage_retrievals: list[dict[str, Any]],
    safe_strength: float,
    llm_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    stage_codes = {str(item.get("code") or "") for item in chain}
    action_strength = max(
        float(rule_analysis.soft_signals.get("transfer_request", 0.0)),
        float(rule_analysis.soft_signals.get("credential_request", 0.0)),
        float(rule_analysis.soft_signals.get("download_redirect", 0.0)),
        float(rule_analysis.soft_signals.get("remote_control", 0.0)),
        float(rule_analysis.soft_signals.get("privacy_request", 0.0)),
        0.0,
    )
    deception_strength = max(
        float(rule_analysis.soft_signals.get("impersonation", 0.0)),
        float(rule_analysis.soft_signals.get("after_sale_pretext", 0.0)),
        float(rule_analysis.soft_signals.get("part_time_bait", 0.0)),
        float(rule_analysis.soft_signals.get("investment_bait", 0.0)),
        0.0,
    )
    pressure_strength = max(
        float(rule_analysis.soft_signals.get("urgency_pressure", 0.0)),
        float(rule_analysis.soft_signals.get("secrecy_isolation", 0.0)),
        0.0,
    )
    entity_strength = _clamp01(
        min(len(list((rule_analysis.extracted_entities or {}).get("urls") or [])), 2) * 0.12
        + min(len(list((rule_analysis.extracted_entities or {}).get("money") or [])), 2) * 0.18
        + min(len(list((rule_analysis.extracted_entities or {}).get("codes") or [])), 2) * 0.16
        + min(len(list((rule_analysis.extracted_entities or {}).get("phones") or [])), 2) * 0.08
    )

    if {"hook", "instruction", "payment"}.issubset(stage_codes):
        closure_score = 0.94
    elif {"instruction", "payment"}.issubset(stage_codes):
        closure_score = 0.8
    elif {"hook", "instruction", "pressure"}.issubset(stage_codes):
        closure_score = 0.72
    elif len(stage_codes) >= 2:
        closure_score = 0.58
    elif current_stage.get("code") == "guard":
        closure_score = 0.18
    else:
        closure_score = max(float(current_stage.get("score") or 0.0), 0.28)

    stage_support = _clamp01(
        sum(float(item.get("support_score") or 0.0) for item in stage_retrievals) / max(1, len(stage_retrievals))
    )
    black_strength = float(retrieval_bundle.features.black_top1 or 0.0)
    white_strength = float(retrieval_bundle.features.white_top1 or 0.0)
    contradiction = _clamp01(
        max(white_strength - black_strength, 0.0) * 0.72
        + (0.14 if retrieval_bundle.features.evidence_alignment == "mixed" else 0.0)
    )

    llm_risk = 0.0
    if isinstance(llm_payload, dict):
        try:
            llm_risk = float(llm_payload.get("confidence") or 0.0)
        except (TypeError, ValueError):
            llm_risk = 0.0
        if llm_risk > 1:
            llm_risk /= 100.0

    raw_score = (
        float(rule_analysis.rule_score) * 0.18
        + float(retrieval_bundle.features.retrieval_score) * 0.12
        + closure_score * 100 * 0.22
        + action_strength * 100 * 0.16
        + stage_support * 100 * 0.12
        + deception_strength * 100 * 0.08
        + pressure_strength * 100 * 0.06
        + entity_strength * 100 * 0.06
        + max(black_strength - white_strength, 0.0) * 100 * 0.06
        + llm_risk * 100 * 0.04
        - safe_strength * 100 * 0.14
        - contradiction * 100 * 0.08
    )
    if current_stage.get("code") == "payment" and action_strength >= 0.48:
        raw_score += 8
    if current_stage.get("code") == "guard" and safe_strength >= 0.44:
        raw_score -= 10
    final_score = _clamp100(raw_score)

    if current_stage.get("code") == "payment" and (final_score >= 62 or action_strength >= 0.52):
        risk_level = "high"
    elif final_score >= 68:
        risk_level = "high"
    elif final_score >= 34 or len(stage_codes) >= 2:
        risk_level = "medium"
    else:
        risk_level = "low"

    confidence = _clamp01(
        0.36
        + closure_score * 0.22
        + stage_support * 0.18
        + max(black_strength - white_strength, 0.0) * 0.14
        - contradiction * 0.12
        - (0.08 if retrieval_bundle.features.evidence_alignment == "mixed" else 0.0)
    )

    return {
        "final_score": final_score,
        "risk_level": risk_level,
        "confidence": confidence,
        "chain_score": _clamp100(closure_score * 100),
        "action_score": _clamp100(action_strength * 100),
        "deception_score": _clamp100(deception_strength * 100),
        "pressure_score": _clamp100(pressure_strength * 100),
        "support_score": _clamp100(stage_support * 100),
        "safety_score": _clamp100(safe_strength * 100),
        "contradiction_score": _clamp100(contradiction * 100),
        "entity_score": _clamp100(entity_strength * 100),
    }


def _predict_next_step(current_stage: dict[str, Any], rule_analysis: rules.RuleAnalysis) -> str:
    stage_code = str(current_stage.get("code") or "")
    entities = rule_analysis.extracted_entities or {}
    if stage_code == "guard":
        return "官方核实"
    if stage_code == "payment":
        if list(entities.get("codes") or []):
            return "索要验证码"
        return "追加转账"
    if stage_code == "pressure":
        if rule_analysis.soft_signals.get("transfer_request", 0.0) >= 0.38:
            return "立即转账"
        return "强化施压"
    if stage_code == "instruction":
        if rule_analysis.soft_signals.get("remote_control", 0.0) >= 0.42:
            return "共享屏幕"
        if list(entities.get("urls") or []):
            return "下载应用"
        return "点击链接"
    if stage_code == "cover_up":
        return "切断核验"
    if rule_analysis.soft_signals.get("impersonation", 0.0) >= 0.38:
        return "发送链接"
    return "建立信任"


def _build_key_relations(
    *,
    chain: list[dict[str, Any]],
    current_stage: dict[str, Any],
    rule_analysis: rules.RuleAnalysis,
) -> list[str]:
    relations: list[str] = []
    if len(chain) >= 2:
        relations.extend(
            f"{left['label']} → {right['label']}"
            for left, right in zip(chain, chain[1:], strict=False)
        )

    entities = rule_analysis.extracted_entities or {}
    if list(entities.get("urls") or []):
        relations.append("链接 → 诱导操作")
    if list(entities.get("money") or []):
        relations.append("金额 → 资金收口")
    if list(entities.get("codes") or []):
        relations.append("验证码 → 账号接管")
    if rule_analysis.soft_signals.get("impersonation", 0.0) >= 0.38:
        relations.append("身份冒充 → 信任建立")
    if str(current_stage.get("code") or "") == "guard":
        relations.append("官方核验 → 降险")
    return _unique_keep_order(relations)[:4]


def _build_intervention_focus(current_stage: dict[str, Any], rule_analysis: rules.RuleAnalysis) -> list[str]:
    stage_code = str(current_stage.get("code") or "")
    focus: list[str] = []
    if stage_code == "guard":
        focus.extend(["官方渠道", "二次核实"])
    if stage_code in {"instruction", "payment"} or rule_analysis.soft_signals.get("download_redirect", 0.0) >= 0.36:
        focus.append("陌生链接")
    if stage_code in {"instruction", "payment"} or rule_analysis.soft_signals.get("remote_control", 0.0) >= 0.36:
        focus.append("共享屏幕")
    if stage_code == "payment" or rule_analysis.soft_signals.get("credential_request", 0.0) >= 0.36:
        focus.append("验证码")
    if stage_code == "payment" or rule_analysis.soft_signals.get("transfer_request", 0.0) >= 0.36:
        focus.append("转账")
    if rule_analysis.soft_signals.get("impersonation", 0.0) >= 0.36:
        focus.append("身份核验")
    return _unique_keep_order(focus)[:4]


def _build_evidence_map(
    *,
    input_highlights: list[dict[str, str]],
    stage_retrievals: list[dict[str, Any]],
    current_stage: dict[str, Any],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    current_stage_label = str(current_stage.get("label") or "")
    for index, item in enumerate(input_highlights[:4]):
        reason = str(item.get("reason") or "").strip()
        text = str(item.get("text") or "").strip()
        tone = "safe" if any(tag in reason for tag in ("反诈", "核验", "劝阻", "官方")) else "danger"
        items.append(
            {
                "id": f"highlight-{index + 1}",
                "source": "原文",
                "label": _snippet(reason or "原文命中", limit=12),
                "text": _snippet(text, limit=56),
                "tone": tone,
                "stage": current_stage_label or ("官方核验" if tone == "safe" else None),
            }
        )

    for stage in stage_retrievals[:3]:
        for index, item in enumerate(list(stage.get("black_hits") or [])[:1]):
            items.append(
                {
                    "id": f"black-{stage['code']}-{index + 1}",
                    "source": "风险样本",
                    "label": _snippet(stage.get("label") or "风险样本", limit=14),
                    "text": _snippet(item.get("chunk_text"), limit=58),
                    "tone": "danger",
                    "stage": stage.get("label"),
                }
            )
        for index, item in enumerate(list(stage.get("white_hits") or [])[:1]):
            items.append(
                {
                    "id": f"white-{stage['code']}-{index + 1}",
                    "source": "安全样本",
                    "label": "安全对照",
                    "text": _snippet(item.get("chunk_text"), limit=58),
                    "tone": "safe",
                    "stage": "官方核验",
                }
            )

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = (str(item.get("source") or ""), str(item.get("text") or ""))
        if key in seen or not key[1]:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:8]


def _build_entity_nodes(rule_analysis: rules.RuleAnalysis) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    entities = rule_analysis.extracted_entities or {}
    order = 0
    for entity_key in ("phones", "urls", "money", "codes"):
        for index, value in enumerate(list(entities.get(entity_key) or [])[:2]):
            nodes.append(
                {
                    "id": f"entity:{entity_key}:{index}",
                    "label": _entity_label(entity_key, str(value), index),
                    "kind": entity_key,
                    "tone": _entity_tone(entity_key),
                    "lane": 1,
                    "order": order,
                    "strength": 0.56 if entity_key in {"money", "codes"} else 0.5,
                    "meta": {
                        "entity_type": entity_key,
                        "display_value": str(value),
                    },
                }
            )
            order += 1
    return nodes


def _pick_support_nodes(
    *,
    stage_retrievals: list[dict[str, Any]],
    safe_strength: float,
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for index, stage in enumerate(stage_retrievals[:3]):
        if list(stage.get("black_hits") or []):
            nodes.append(
                {
                    "id": f"support:black:{stage['code']}",
                    "label": f"{stage['label']}参照",
                    "kind": "support",
                    "tone": "danger",
                    "lane": 1,
                    "order": 10 + index,
                    "strength": max(0.46, float(stage.get("support_score") or 0.0)),
                    "meta": {"stage_code": stage["code"], "source": "black"},
                }
            )
        if list(stage.get("white_hits") or []):
            nodes.append(
                {
                    "id": f"support:white:{stage['code']}",
                    "label": "安全对照",
                    "kind": "support",
                    "tone": "safe",
                    "lane": 1,
                    "order": 20 + index,
                    "strength": max(0.42, safe_strength),
                    "meta": {"stage_code": stage["code"], "source": "white"},
                }
            )
    return nodes


def _stage_node(stage: dict[str, Any], order: int, *, support_score: float | None = None) -> dict[str, Any]:
    base_strength = float(stage.get("score") or 0.0)
    if support_score is not None:
        base_strength = max(base_strength, float(support_score))
    return {
        "id": f"stage:{stage['code']}",
        "label": stage["label"],
        "kind": "stage",
        "tone": stage["tone"],
        "lane": 2,
        "order": order,
        "strength": max(0.42, base_strength),
        "meta": {
            "stage_code": stage["code"],
            "stage_score": stage.get("score"),
            "support_score": support_score,
        },
    }


def _link_entity_to_stage(
    entity_type: str,
    *,
    current_stage: dict[str, Any],
    chain: list[dict[str, Any]],
) -> str:
    available_codes = {str(item.get("code") or "") for item in chain}
    available_codes.add(str(current_stage.get("code") or ""))
    if entity_type == "phones":
        return "stage:hook" if "hook" in available_codes else f"stage:{current_stage['code']}"
    if entity_type == "urls":
        return "stage:instruction" if "instruction" in available_codes else f"stage:{current_stage['code']}"
    if entity_type in {"money", "codes"}:
        return "stage:payment" if "payment" in available_codes else f"stage:{current_stage['code']}"
    return f"stage:{current_stage['code']}"


def _build_stage_rows(
    *,
    stage_scores: list[dict[str, Any]],
    stage_retrievals: list[dict[str, Any]],
    chain: list[dict[str, Any]],
    current_stage: dict[str, Any],
) -> list[dict[str, Any]]:
    support_map = {str(item.get("code") or ""): item for item in stage_retrievals}
    active_codes = {str(item.get("code") or "") for item in chain}
    active_codes.add(str(current_stage.get("code") or ""))
    rows: list[dict[str, Any]] = []
    for stage in stage_scores:
        support = support_map.get(str(stage.get("code") or ""), {})
        rows.append(
            {
                "code": stage["code"],
                "label": stage["label"],
                "score": stage["score"],
                "support_score": float(support.get("support_score") or 0.0),
                "active": stage["code"] in active_codes,
                "tone": stage["tone"],
                "black_count": int(support.get("black_count") or 0),
                "white_count": int(support.get("white_count") or 0),
                "keywords": list(support.get("keywords") or [])[:4],
            }
        )
    if current_stage.get("code") == "guard":
        rows.append(
            {
                "code": "guard",
                "label": "官方核验",
                "score": float(current_stage.get("score") or 0.0),
                "support_score": float(current_stage.get("score") or 0.0),
                "active": True,
                "tone": "safe",
                "black_count": 0,
                "white_count": 0,
                "keywords": ["官方", "核验"],
            }
        )
    return rows


def _build_storage_snapshot(*, stage_rows: list[dict[str, Any]], graph: dict[str, Any]) -> dict[str, Any]:
    return {
        "stages": [
            {
                "stage_code": str(item.get("code") or ""),
                "stage_label": str(item.get("label") or ""),
                "stage_order": index,
                "score": float(item.get("score") or 0.0),
                "support_score": float(item.get("support_score") or 0.0),
                "is_active": bool(item.get("active")),
                "tone": str(item.get("tone") or ""),
                "detail": " · ".join(
                    part
                    for part in [
                        f"风险 {int(item.get('black_count') or 0)}",
                        f"安全 {int(item.get('white_count') or 0)}",
                        "、".join(list(item.get("keywords") or [])[:4]),
                    ]
                    if part
                ) or None,
            }
            for index, item in enumerate(stage_rows)
            if str(item.get("code") or "").strip()
        ],
        "nodes": [
            {
                "node_key": str(node.get("id") or ""),
                "node_label": str(node.get("label") or ""),
                "node_type": str(node.get("kind") or ""),
                "tone": str(node.get("tone") or ""),
                "lane": int(node.get("lane") or 0),
                "sort_order": int(node.get("order") or 0),
                "weight": float(node.get("strength") or 0.0),
                "stage_code": (
                    str((node.get("meta") or {}).get("stage_code") or "")
                    if isinstance(node.get("meta"), dict)
                    else ""
                ) or (str(node.get("id") or "").split("stage:", 1)[1] if str(node.get("id") or "").startswith("stage:") else None),
                "detail": (
                    _snippet(str((node.get("meta") or {}).get("display_value") or ""), limit=80)
                    if isinstance(node.get("meta"), dict) and str((node.get("meta") or {}).get("display_value") or "").strip()
                    else None
                ),
            }
            for node in list(graph.get("nodes") or [])
            if str(node.get("id") or "").strip()
        ],
        "edges": [
            {
                "edge_key": str(edge.get("id") or ""),
                "source_key": str(edge.get("source") or ""),
                "target_key": str(edge.get("target") or ""),
                "relation_type": str(edge.get("kind") or ""),
                "tone": str(edge.get("tone") or ""),
                "weight": float(edge.get("weight") or 0.0),
                "detail": (
                    f"{str(edge.get('kind') or '').strip()} · {round(float(edge.get('weight') or 0) * 100)}"
                    if str(edge.get("kind") or "").strip()
                    else None
                ),
            }
            for edge in list(graph.get("edges") or [])
            if str(edge.get("source") or "").strip() and str(edge.get("target") or "").strip()
        ],
    }


def _build_risk_evidence(
    *,
    current_stage: dict[str, Any],
    key_relations: list[str],
    rule_analysis: rules.RuleAnalysis,
    stage_retrievals: list[dict[str, Any]],
) -> list[str]:
    items: list[str] = []
    if current_stage.get("code") not in {"guard", "pending"}:
        items.append(f"推进至{current_stage['label']}")
    items.extend(key_relations[:2])
    items.extend(rule_analysis.risk_evidence[:3])
    for stage in stage_retrievals:
        if float(stage.get("support_score") or 0.0) >= 0.42 and list(stage.get("black_hits") or []):
            items.append(f"{stage['label']}参照成立")
    return _unique_keep_order(items)[:5]


def _build_counter_evidence(
    *,
    current_stage: dict[str, Any],
    rule_analysis: rules.RuleAnalysis,
    stage_retrievals: list[dict[str, Any]],
    safe_strength: float,
) -> list[str]:
    items: list[str] = []
    items.extend(rule_analysis.counter_evidence[:3])
    if current_stage.get("code") == "guard":
        items.append("出现官方核验路径")
    if safe_strength >= 0.42:
        items.append("存在明确降险信号")
    for stage in stage_retrievals:
        if list(stage.get("white_hits") or []):
            items.append(f"{stage['label']}存在安全对照")
    return _unique_keep_order(items)[:5]


def _build_summary(*, current_stage: dict[str, Any], predicted_next_step: str, decision: dict[str, Any]) -> str:
    risk_level = str(decision.get("risk_level") or "")
    if current_stage.get("code") == "guard" or risk_level == "low":
        return "当前更像官方核验或反诈提醒，未形成完整诈骗推进链。"
    if risk_level == "high":
        return f"文本已推进到{current_stage['label']}，下一步更可能{predicted_next_step}。"
    return f"文本已形成{current_stage['label']}前后链路，仍需防止继续转入{predicted_next_step}。"


def _build_final_reason(
    *,
    chain: list[dict[str, Any]],
    current_stage: dict[str, Any],
    predicted_next_step: str,
    decision: dict[str, Any],
    key_relations: list[str],
    stage_retrievals: list[dict[str, Any]],
    safe_strength: float,
) -> str:
    chain_labels = " → ".join(stage["label"] for stage in chain) if chain else current_stage["label"]
    support_labels = "、".join(
        stage["label"]
        for stage in stage_retrievals
        if float(stage.get("support_score") or 0.0) >= 0.38
    )
    parts = [
        f"阶段链：{chain_labels}。",
        f"当前停留在{current_stage['label']}，下一步倾向{predicted_next_step}。",
    ]
    if support_labels:
        parts.append(f"定向检索支撑集中在{support_labels}。")
    if key_relations:
        parts.append(f"关键关系：{key_relations[0]}。")
    if current_stage.get("code") == "guard" or str(decision.get("risk_level") or "") == "low":
        parts.append(f"同时存在较强反证约束，降险强度 {decision['safety_score']}。")
    else:
        parts.append(
            f"链路完整度 {decision['chain_score']}，危险动作强度 {decision['action_score']}，反证抵消 {decision['contradiction_score']}。"
        )
    if safe_strength >= 0.4 and current_stage.get("code") != "guard":
        parts.append("虽然出现部分降险信号，但不足以打断已形成的风险推进链。")
    return "".join(parts)


def _build_advice(
    *,
    current_stage: dict[str, Any],
    predicted_next_step: str,
    intervention_focus: list[str],
    decision: dict[str, Any],
) -> list[str]:
    stage_code = str(current_stage.get("code") or "")
    advice: list[str] = []
    if stage_code == "guard" or str(decision.get("risk_level") or "") == "low":
        advice.extend(["继续走官方渠道核实", "不要转到私聊或陌生链接", "核对号码与平台来源"])
    if stage_code in {"instruction", "pressure", "payment"}:
        advice.append("不要点击陌生链接")
    if stage_code in {"instruction", "payment"}:
        advice.extend(["不要安装来历不明应用", "不要共享屏幕"])
    if stage_code == "payment":
        advice.extend(["暂停转账", "不要提供验证码"])
    if predicted_next_step in {"索要验证码", "追加转账"}:
        advice.append("立即中止当前操作")
    advice.extend(intervention_focus)
    advice.append("保留聊天记录")
    return _unique_keep_order(advice)[:4]


def build_kag_payload(
    db: Session,
    *,
    text: str,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
    black_evidence: list[dict[str, Any]],
    white_evidence: list[dict[str, Any]],
    input_highlights: list[dict[str, str]],
    risk_level: str,
    fraud_type: str,
    final_score: int,
    confidence: float,
    llm_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_strength = _safe_strength(rule_analysis, retrieval_bundle)
    stage_scores = _build_stage_scores(
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
        safe_strength=safe_strength,
    )
    chain, current_stage = _choose_stage_chain(
        stage_scores=stage_scores,
        risk_level=risk_level,
        safe_strength=safe_strength,
    )
    stage_retrievals = _run_stage_retrievals(
        db,
        text=text,
        chain=chain or [current_stage],
        rule_analysis=rule_analysis,
    )
    predicted_next_step = _predict_next_step(current_stage, rule_analysis)
    key_relations = _build_key_relations(chain=chain, current_stage=current_stage, rule_analysis=rule_analysis)
    intervention_focus = _build_intervention_focus(current_stage, rule_analysis)
    evidence_map = _build_evidence_map(
        input_highlights=input_highlights,
        stage_retrievals=stage_retrievals,
        current_stage=current_stage,
    )

    metrics = _chain_metrics(
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
        chain=chain,
        current_stage=current_stage,
        stage_retrievals=stage_retrievals,
        safe_strength=safe_strength,
        llm_payload=llm_payload,
    )
    stage_rows = _build_stage_rows(
        stage_scores=stage_scores,
        stage_retrievals=stage_retrievals,
        chain=chain,
        current_stage=current_stage,
    )
    merged_black_evidence = _merge_evidence(
        black_evidence,
        [item for stage in stage_retrievals for item in list(stage.get("black_hits") or [])],
    )
    merged_white_evidence = _merge_evidence(
        white_evidence,
        [item for stage in stage_retrievals for item in list(stage.get("white_hits") or [])],
    )

    decision = {
        "final_score": metrics["final_score"],
        "risk_level": metrics["risk_level"],
        "confidence": metrics["confidence"],
        "is_fraud": metrics["risk_level"] != "low",
        "need_manual_review": bool(
            metrics["risk_level"] == "medium"
            or metrics["confidence"] < 0.56
            or metrics["contradiction_score"] >= 42
            or (metrics["support_score"] <= 36 and metrics["chain_score"] >= 48)
        ),
    }
    decision["summary"] = _build_summary(current_stage=current_stage, predicted_next_step=predicted_next_step, decision=decision)
    decision["risk_evidence"] = _build_risk_evidence(
        current_stage=current_stage,
        key_relations=key_relations,
        rule_analysis=rule_analysis,
        stage_retrievals=stage_retrievals,
    )
    decision["counter_evidence"] = _build_counter_evidence(
        current_stage=current_stage,
        rule_analysis=rule_analysis,
        stage_retrievals=stage_retrievals,
        safe_strength=safe_strength,
    )
    decision["final_reason"] = _build_final_reason(
        chain=chain,
        current_stage=current_stage,
        predicted_next_step=predicted_next_step,
        decision={**decision, **metrics},
        key_relations=key_relations,
        stage_retrievals=stage_retrievals,
        safe_strength=safe_strength,
    )
    decision["advice"] = _build_advice(
        current_stage=current_stage,
        predicted_next_step=predicted_next_step,
        intervention_focus=intervention_focus,
        decision=decision,
    )

    nodes: list[dict[str, Any]] = [
        {
            "id": "input",
            "label": "原文",
            "kind": "input",
            "tone": "primary",
            "lane": 0,
            "order": 0,
            "strength": 0.78,
            "meta": {},
        }
    ]
    entity_nodes = _build_entity_nodes(rule_analysis)
    support_nodes = _pick_support_nodes(stage_retrievals=stage_retrievals, safe_strength=safe_strength)
    support_map = {str(item.get("code") or ""): float(item.get("support_score") or 0.0) for item in stage_retrievals}
    stage_nodes = [
        _stage_node(stage, index, support_score=support_map.get(str(stage.get("code") or "")))
        for index, stage in enumerate(chain or [current_stage])
    ]
    if current_stage["code"] == "guard" and not any(str(node.get("id")) == "stage:guard" for node in stage_nodes):
        stage_nodes.append(_stage_node(current_stage, len(stage_nodes), support_score=safe_strength))

    result_node = {
        "id": "risk_level",
        "label": _RISK_LABELS.get(decision["risk_level"], "待判定"),
        "kind": "risk",
        "tone": "danger" if decision["risk_level"] == "high" else "warning" if decision["risk_level"] == "medium" else "safe",
        "lane": 3,
        "order": 0,
        "strength": max(0.42, min(0.96, float(decision["final_score"]) / 100)),
        "meta": {
            "fraud_type": fraud_type,
            "final_score": decision["final_score"],
            "confidence": decision["confidence"],
        },
    }
    nodes.extend(entity_nodes)
    nodes.extend(support_nodes)
    nodes.extend(stage_nodes)
    nodes.append(result_node)

    edges: list[dict[str, Any]] = []
    entity_type_lookup = {
        str(node["id"]): str(node.get("meta", {}).get("entity_type") or "")
        for node in entity_nodes
    }
    for node in entity_nodes:
        edges.append(
            {
                "id": f"edge:input:{node['id']}",
                "source": "input",
                "target": node["id"],
                "tone": node["tone"],
                "kind": "entity_extract",
                "weight": 0.48,
            }
        )
        edges.append(
            {
                "id": f"edge:{node['id']}:stage",
                "source": node["id"],
                "target": _link_entity_to_stage(
                    entity_type_lookup.get(str(node["id"]), ""),
                    current_stage=current_stage,
                    chain=chain,
                ),
                "tone": node["tone"],
                "kind": "entity_support",
                "weight": 0.54,
            }
        )

    for node in support_nodes:
        stage_code = str(node.get("meta", {}).get("stage_code") or current_stage.get("code") or "")
        target_stage_id = f"stage:{stage_code}"
        if not any(str(stage_node["id"]) == target_stage_id for stage_node in stage_nodes):
            target_stage_id = "risk_level"
        edges.extend(
            [
                {
                    "id": f"edge:input:{node['id']}",
                    "source": "input",
                    "target": node["id"],
                    "tone": node["tone"],
                    "kind": "case_support" if node.get("tone") == "danger" else "counter_support",
                    "weight": 0.5 if node.get("tone") == "safe" else 0.52,
                },
                {
                    "id": f"edge:{node['id']}:{target_stage_id}",
                    "source": node["id"],
                    "target": target_stage_id,
                    "tone": node["tone"],
                    "kind": "case_align" if node.get("tone") == "danger" else "counter_balance",
                    "weight": max(0.42, float(node.get("strength") or 0.42)),
                },
            ]
        )

    ordered_stage_nodes = sorted(stage_nodes, key=lambda item: int(item.get("order") or 0))
    for left, right in zip(ordered_stage_nodes, ordered_stage_nodes[1:], strict=False):
        edges.append(
            {
                "id": f"edge:{left['id']}:{right['id']}",
                "source": left["id"],
                "target": right["id"],
                "tone": right["tone"],
                "kind": "stage_flow",
                "weight": 0.62,
            }
        )
    final_stage_id = ordered_stage_nodes[-1]["id"] if ordered_stage_nodes else f"stage:{current_stage['code']}"
    edges.append(
        {
            "id": "edge:stage:risk_level",
            "source": final_stage_id,
            "target": "risk_level",
            "tone": result_node["tone"],
            "kind": "decision",
            "weight": max(0.48, float(decision["final_score"]) / 100),
        }
    )

    highlighted_path = ["input"]
    if entity_nodes:
        highlighted_path.append(str(entity_nodes[0]["id"]))
    elif support_nodes:
        highlighted_path.append(str(support_nodes[0]["id"]))
    highlighted_path.extend(str(node["id"]) for node in ordered_stage_nodes)
    highlighted_path.append("risk_level")
    highlighted_path = _unique_keep_order(highlighted_path)
    label_lookup = {str(node["id"]): str(node["label"]) for node in nodes}
    reasoning_path = [label_lookup[node_id] for node_id in highlighted_path if node_id in label_lookup]

    graph = {
        "nodes": nodes,
        "edges": edges,
        "highlighted_path": highlighted_path,
        "highlighted_labels": reasoning_path,
        "lane_labels": ["输入", "线索", "阶段", "结论"],
        "summary_metrics": {
            "entity_count": len(entity_nodes),
            "relation_count": len(edges),
            "stage_count": len(ordered_stage_nodes),
            "counter_count": len([item for item in support_nodes if str(item.get("tone")) == "safe"]),
            "final_score": decision["final_score"],
            "confidence": decision["confidence"],
        },
    }
    storage_snapshot = _build_storage_snapshot(stage_rows=stage_rows, graph=graph)

    _ = final_score
    _ = confidence

    return {
        "enabled": True,
        "mode": "deep",
        "current_stage": {
            "code": current_stage["code"],
            "label": current_stage["label"],
            "score": current_stage.get("score"),
            "tone": current_stage.get("tone"),
        },
        "predicted_next_step": predicted_next_step,
        "trajectory": [stage["label"] for stage in chain] if chain else [current_stage["label"]],
        "stage_scores": [
            {
                "code": item["code"],
                "label": item["label"],
                "score": item["score"],
                "active": bool(next((row for row in stage_rows if row["code"] == item["code"] and row["active"]), None)),
                "tone": item["tone"],
            }
            for item in stage_scores
        ],
        "stage_rows": stage_rows,
        "stage_retrievals": stage_retrievals,
        "key_relations": key_relations,
        "intervention_focus": intervention_focus,
        "evidence_map": evidence_map,
        "entity_count": len(entity_nodes),
        "relation_count": len(edges),
        "signal_count": len([item for item in stage_rows if float(item.get("score") or 0.0) >= 0.24]),
        "counter_signal_count": len([item for item in evidence_map if str(item.get("tone")) == "safe"]),
        "reasoning_path": reasoning_path,
        "reasoning_graph": graph,
        "metrics": metrics,
        "merged_black_evidence": merged_black_evidence,
        "merged_white_evidence": merged_white_evidence,
        "decision": decision,
        "storage_snapshot": storage_snapshot,
    }
