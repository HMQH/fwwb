"""反诈深度推理：时序风险链 + 反证约束。"""
from __future__ import annotations

from typing import Any

from app.domain.detection import retrieval, rules

_STAGE_BLUEPRINTS: tuple[dict[str, Any], ...] = (
    {
        "code": "hook",
        "label": "接触建链",
        "tone": "primary",
        "order": 0,
        "stage_tag": "hook",
        "signal_weights": {
            "impersonation": 0.34,
            "after_sale_pretext": 0.2,
            "part_time_bait": 0.22,
            "investment_bait": 0.22,
        },
        "entity_bonus": {"phones": 0.08},
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
        },
        "entity_bonus": {"urls": 0.14, "codes": 0.06},
    },
    {
        "code": "pressure",
        "label": "施压锁定",
        "tone": "warning",
        "order": 2,
        "stage_tag": "pressure",
        "signal_weights": {
            "urgency_pressure": 0.34,
            "secrecy_isolation": 0.24,
            "impersonation": 0.08,
        },
        "entity_bonus": {},
    },
    {
        "code": "payment",
        "label": "资金收口",
        "tone": "danger",
        "order": 3,
        "stage_tag": "payment",
        "signal_weights": {
            "transfer_request": 0.34,
            "credential_request": 0.3,
            "remote_control": 0.08,
        },
        "entity_bonus": {"money": 0.14, "codes": 0.12},
    },
    {
        "code": "cover_up",
        "label": "隔离断联",
        "tone": "danger",
        "order": 4,
        "stage_tag": "cover_up",
        "signal_weights": {
            "secrecy_isolation": 0.28,
            "urgency_pressure": 0.12,
        },
        "entity_bonus": {},
    },
)

_SAFE_STAGE = {
    "code": "guard",
    "label": "官方核验",
    "tone": "safe",
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

    if risk_level == "low" and safe_strength >= 0.3:
        current = {
            "code": _SAFE_STAGE["code"],
            "label": _SAFE_STAGE["label"],
            "tone": _SAFE_STAGE["tone"],
            "score": safe_strength,
        }
        chain = active[:2] if active else []
        return chain, current

    if not active:
        top = max(stage_scores, key=lambda item: float(item.get("score") or 0.0), default=None)
        if top is None:
            return [], {
                "code": "pending",
                "label": "待判定",
                "tone": "primary",
                "score": 0.0,
            }
        return [top], top

    current = active[-1]
    return active[:4], current


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
    black_evidence: list[dict[str, Any]],
    white_evidence: list[dict[str, Any]],
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

    for index, item in enumerate(black_evidence[:2]):
        items.append(
            {
                "id": f"black-{index + 1}",
                "source": "风险样本",
                "label": _snippet(item.get("fraud_type") or "风险案例", limit=12),
                "text": _snippet(item.get("chunk_text"), limit=56),
                "tone": "danger",
                "stage": current_stage_label,
            }
        )

    for index, item in enumerate(white_evidence[:2]):
        items.append(
            {
                "id": f"white-{index + 1}",
                "source": "安全样本",
                "label": "安全对照",
                "text": _snippet(item.get("chunk_text"), limit=56),
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
    return deduped[:6]


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
    black_evidence: list[dict[str, Any]],
    white_evidence: list[dict[str, Any]],
    safe_strength: float,
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    if black_evidence:
        nodes.append(
            {
                "id": "support:black",
                "label": "风险对照",
                "kind": "support",
                "tone": "danger",
                "lane": 1,
                "order": 4,
                "strength": 0.62,
                "meta": {},
            }
        )
    if white_evidence or safe_strength >= 0.3:
        nodes.append(
            {
                "id": "support:white",
                "label": "安全对照",
                "kind": "support",
                "tone": "safe",
                "lane": 1,
                "order": 5,
                "strength": max(0.44, safe_strength),
                "meta": {},
            }
        )
    return nodes


def _stage_node(stage: dict[str, Any], order: int) -> dict[str, Any]:
    return {
        "id": f"stage:{stage['code']}",
        "label": stage["label"],
        "kind": "stage",
        "tone": stage["tone"],
        "lane": 2,
        "order": order,
        "strength": max(0.42, float(stage.get("score") or 0.42)),
        "meta": {
            "stage_code": stage["code"],
            "stage_score": stage.get("score"),
        },
    }


def _link_entity_to_stage(entity_id: str, *, entities_lookup: dict[str, str], current_stage: dict[str, Any], chain: list[dict[str, Any]]) -> str:
    entity_type = entities_lookup.get(entity_id, "")
    available_codes = {str(item.get("code") or "") for item in chain}
    available_codes.add(str(current_stage.get("code") or ""))
    if entity_type == "phones":
        return "stage:hook" if "hook" in available_codes else f"stage:{current_stage['code']}"
    if entity_type == "urls":
        return "stage:instruction" if "instruction" in available_codes else f"stage:{current_stage['code']}"
    if entity_type in {"money", "codes"}:
        return "stage:payment" if "payment" in available_codes else f"stage:{current_stage['code']}"
    return f"stage:{current_stage['code']}"


def build_kag_payload(
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
) -> dict[str, Any]:
    _ = text
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
    predicted_next_step = _predict_next_step(current_stage, rule_analysis)
    key_relations = _build_key_relations(
        chain=chain,
        current_stage=current_stage,
        rule_analysis=rule_analysis,
    )
    intervention_focus = _build_intervention_focus(current_stage, rule_analysis)
    evidence_map = _build_evidence_map(
        input_highlights=input_highlights,
        black_evidence=black_evidence,
        white_evidence=white_evidence,
        current_stage=current_stage,
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
    support_nodes = _pick_support_nodes(
        black_evidence=black_evidence,
        white_evidence=white_evidence,
        safe_strength=safe_strength,
    )
    stage_nodes = [_stage_node(stage, index) for index, stage in enumerate(chain or [current_stage])]
    result_node = {
        "id": "risk_level",
        "label": {"high": "高风险", "medium": "需核验", "low": "低风险"}.get(risk_level, "待判定"),
        "kind": "risk",
        "tone": "danger" if risk_level == "high" else "warning" if risk_level == "medium" else "safe",
        "lane": 3,
        "order": 0,
        "strength": max(0.42, min(0.96, final_score / 100)),
        "meta": {
            "fraud_type": fraud_type,
            "final_score": final_score,
            "confidence": confidence,
        },
    }
    nodes.extend(entity_nodes)
    nodes.extend(support_nodes)
    nodes.extend(stage_nodes)
    nodes.append(result_node)

    edges: list[dict[str, Any]] = []
    entities_lookup = {
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
                    str(node["id"]),
                    entities_lookup=entities_lookup,
                    current_stage=current_stage,
                    chain=chain,
                ),
                "tone": node["tone"],
                "kind": "entity_support",
                "weight": 0.54,
            }
        )

    if any(item["id"] == "support:black" for item in support_nodes):
        if any(item.get("code") == "payment" for item in chain):
            target_stage_id = "stage:payment"
        elif stage_nodes:
            target_stage_id = str(stage_nodes[-1]["id"])
        else:
            target_stage_id = f"stage:{current_stage['code']}"
        edges.extend(
            [
                {
                    "id": "edge:input:support:black",
                    "source": "input",
                    "target": "support:black",
                    "tone": "danger",
                    "kind": "case_support",
                    "weight": 0.52,
                },
                {
                    "id": "edge:support:black:stage",
                    "source": "support:black",
                    "target": target_stage_id,
                    "tone": "danger",
                    "kind": "case_align",
                    "weight": 0.58,
                },
            ]
        )

    if any(item["id"] == "support:white" for item in support_nodes):
        target_stage_id = "stage:guard" if current_stage["code"] == "guard" else "risk_level"
        edges.extend(
            [
                {
                    "id": "edge:input:support:white",
                    "source": "input",
                    "target": "support:white",
                    "tone": "safe",
                    "kind": "counter_support",
                    "weight": 0.5,
                },
                {
                    "id": "edge:support:white:target",
                    "source": "support:white",
                    "target": target_stage_id,
                    "tone": "safe",
                    "kind": "counter_balance",
                    "weight": max(0.42, safe_strength),
                },
            ]
        )

    if current_stage["code"] == "guard":
        if not any(str(node.get("id")) == "stage:guard" for node in nodes):
            nodes.append(
                {
                    "id": "stage:guard",
                    "label": _SAFE_STAGE["label"],
                    "kind": "stage",
                    "tone": _SAFE_STAGE["tone"],
                    "lane": 2,
                    "order": len(stage_nodes),
                    "strength": max(0.44, safe_strength),
                    "meta": {"stage_score": safe_strength},
                }
            )
        edges.append(
            {
                "id": "edge:stage:guard:risk",
                "source": "stage:guard",
                "target": "risk_level",
                "tone": "safe",
                "kind": "decision_balance",
                "weight": max(0.42, safe_strength),
            }
        )
    else:
        for left, right in zip(stage_nodes, stage_nodes[1:], strict=False):
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
        final_stage_id = stage_nodes[-1]["id"] if stage_nodes else f"stage:{current_stage['code']}"
        edges.append(
            {
                "id": "edge:stage:risk_level",
                "source": final_stage_id,
                "target": "risk_level",
                "tone": result_node["tone"],
                "kind": "decision",
                "weight": max(0.48, final_score / 100),
            }
        )

    highlighted_path = ["input"]
    first_entity = entity_nodes[0]["id"] if entity_nodes else ("support:white" if current_stage["code"] == "guard" and any(item["id"] == "support:white" for item in support_nodes) else None)
    if first_entity:
        highlighted_path.append(first_entity)
    if current_stage["code"] == "guard":
        highlighted_path.extend(["stage:guard", "risk_level"])
    else:
        highlighted_path.extend([node["id"] for node in stage_nodes] or [f"stage:{current_stage['code']}"])
        highlighted_path.append("risk_level")
    highlighted_path = _unique_keep_order(highlighted_path)
    label_lookup = {str(node["id"]): str(node["label"]) for node in nodes}
    reasoning_path = [label_lookup[node_id] for node_id in highlighted_path if node_id in label_lookup]

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
                "active": item["label"] in [stage["label"] for stage in chain],
                "tone": item["tone"],
            }
            for item in stage_scores
        ],
        "key_relations": key_relations,
        "intervention_focus": intervention_focus,
        "evidence_map": evidence_map,
        "entity_count": len(entity_nodes),
        "relation_count": len(edges),
        "signal_count": len([item for item in stage_scores if float(item.get("score") or 0.0) >= 0.24]),
        "counter_signal_count": len([item for item in evidence_map if str(item.get("tone")) == "safe"]),
        "reasoning_path": reasoning_path,
        "reasoning_graph": {
            "nodes": nodes,
            "edges": edges,
            "highlighted_path": highlighted_path,
            "highlighted_labels": reasoning_path,
            "lane_labels": ["输入", "线索", "阶段", "结论"],
            "summary_metrics": {
                "entity_count": len(entity_nodes),
                "relation_count": len(edges),
                "stage_count": len(chain) if chain else 1,
                "counter_count": len([item for item in evidence_map if str(item.get("tone")) == "safe"]),
                "final_score": final_score,
                "confidence": confidence,
            },
        },
    }
