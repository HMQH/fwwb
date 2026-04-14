"""规则 + 检索 + LLM 的检测分析编排。"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.domain.detection import llm, prompts, retrieval, rules
from app.shared.core.config import settings


@dataclass(slots=True)
class DetectionAnalysis:
    rule_score: int
    retrieval_query: str
    llm_model: str | None
    result_payload: dict[str, Any]


_CRITICAL_RULES = {"索要验证码", "要求转账付款", "远程控制或共享屏幕", "引导下载或点击链接"}
_UNKNOWN_FRAUD_TYPES = {"", "未知", "不确定", "无法判断", "无法确认"}
_BAD_LLM_PHRASES = {"乱码", "无法确认为诈骗"}


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


def _safe_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(0.99, result))


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


def _normalize_risk_level(value: Any, score: int) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized
    if score >= settings.detection_high_risk_threshold:
        return "high"
    if score >= settings.detection_low_risk_threshold:
        return "medium"
    return "low"


def _score_with_retrieval(rule_score: int, black_count: int, white_count: int) -> int:
    score = rule_score + black_count * 8 - white_count * 5
    return max(0, min(100, score))


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
    return "未知"


def _fallback_summary(risk_level: str, fraud_type: str, rule_analysis: rules.RuleAnalysis) -> str:
    if risk_level == "high":
        return f"文本呈现明显高危特征，偏向{fraud_type}。"
    if risk_level == "medium":
        return f"文本存在可疑迹象，需警惕{fraud_type}相关风险。"
    if rule_analysis.hit_rules:
        return "文本存在少量风险线索，但证据仍不足。"
    return "当前文本更接近普通沟通，未见强烈诈骗信号。"


def _fallback_advice(rule_analysis: rules.RuleAnalysis, risk_level: str) -> list[str]:
    advice: list[str] = []
    if any(name in rule_analysis.hit_rules for name in {"索要验证码", "索要敏感信息"}):
        advice.append("不要向对方提供验证码、密码、银行卡或身份证信息。")
    if any(name in rule_analysis.hit_rules for name in {"要求转账付款", "远程控制或共享屏幕"}):
        advice.append("不要继续转账、扫码支付，也不要开启远程协助或共享屏幕。")
    if any(name in rule_analysis.hit_rules for name in {"引导下载或点击链接", "退款售后诱导"}):
        advice.append("不要点击陌生链接或下载陌生 APP，请改用官方渠道核验。")
    if risk_level != "low":
        advice.append("通过官方客服电话或官方 App 自行核实，不要回拨对方给出的号码。")
        advice.append("如已操作转账或泄露验证码，请立刻修改密码并联系银行/平台冻结。")
    if not advice:
        advice.append("保留聊天记录与链接，遇到金钱或账号操作时先通过官方渠道二次确认。")
    return _unique_keep_order(advice)[:4]


def _build_fallback_reason(
    *,
    fraud_type: str,
    risk_level: str,
    rule_analysis: rules.RuleAnalysis,
    retrieval_bundle: retrieval.RetrievalBundle,
) -> str:
    hit_text = "、".join(rule_analysis.hit_rules[:4]) or "暂无明显规则命中"
    black_signal = retrieval_bundle.black_hits[0].fraud_type if retrieval_bundle.black_hits else ""
    white_signal = retrieval_bundle.white_hits[0].fraud_type if retrieval_bundle.white_hits else ""
    parts = [f"规则层命中：{hit_text}。"]
    if black_signal:
        parts.append(f"检索到的黑样本主要指向“{black_signal}”。")
    if white_signal:
        parts.append("同时也召回部分白样本，说明仍需核验边界。")
    parts.append(f"综合判断，当前风险等级为 {risk_level}，最可能关联 {fraud_type}。")
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


def _stabilize_risk_level(
    *,
    risk_level: str,
    composite_score: int,
    rule_analysis: rules.RuleAnalysis,
    black_count: int,
    white_count: int,
) -> str:
    critical_count = len([name for name in rule_analysis.hit_rules if name in _CRITICAL_RULES])
    if composite_score >= settings.detection_high_risk_threshold and critical_count >= 2:
        return "high"
    if "?????" in rule_analysis.hit_rules and (
        "?????????" in rule_analysis.hit_rules or "??????" in rule_analysis.hit_rules
    ):
        return "high"
    if composite_score < settings.detection_low_risk_threshold and white_count > black_count + 1:
        return "low"
    return risk_level


def analyze_text_submission(db: Session, *, text: str) -> DetectionAnalysis:
    normalized_text = rules.normalize_text(text)
    rule_analysis = rules.analyze_text(normalized_text)
    retrieval_bundle = retrieval.retrieve_text_evidence(db, text=normalized_text, rule_analysis=rule_analysis)

    black_evidence = [retrieval.format_evidence(hit) for hit in retrieval_bundle.black_hits]
    white_evidence = [retrieval.format_evidence(hit) for hit in retrieval_bundle.white_hits]
    composite_score = _score_with_retrieval(
        rule_analysis.rule_score,
        black_count=len(black_evidence),
        white_count=len(white_evidence),
    )

    llm_payload: dict[str, Any] = {}
    llm_model: str | None = None
    try:
        system_prompt, user_prompt = prompts.build_detection_prompts(
            text=normalized_text,
            rule_analysis=rule_analysis,
            retrieval=retrieval_bundle,
        )
        client = llm.build_chat_json_client()
        llm_result = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        llm_payload = llm_result.payload
        llm_model = llm_result.model_name
    except Exception:  # noqa: BLE001 - LLM 失败时仍输出可解释的回退结果
        llm_payload = {}
        llm_model = None

    risk_level = _normalize_risk_level(llm_payload.get("risk_level"), composite_score)
    risk_level = _stabilize_risk_level(
        risk_level=risk_level,
        composite_score=composite_score,
        rule_analysis=rule_analysis,
        black_count=len(black_evidence),
        white_count=len(white_evidence),
    )
    fraud_type = _pick_fraud_type(llm_payload, rule_analysis, retrieval_bundle)
    is_fraud_default = risk_level in {"medium", "high"}
    is_fraud = _safe_bool(llm_payload.get("is_fraud"), is_fraud_default)

    confidence_default = min(0.95, 0.34 + composite_score / 100)
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

    raw_summary = str(llm_payload.get("summary") or "").strip()
    raw_reason = str(llm_payload.get("final_reason") or "").strip()
    summary = raw_summary if not _looks_bad_llm_text(raw_summary) else _fallback_summary(
        risk_level,
        fraud_type,
        rule_analysis,
    )
    final_reason = raw_reason if not _looks_bad_llm_text(raw_reason) else _build_fallback_reason(
        fraud_type=fraud_type,
        risk_level=risk_level,
        rule_analysis=rule_analysis,
        retrieval_bundle=retrieval_bundle,
    )
    advice = _unique_keep_order(
        [str(item).strip() for item in (llm_payload.get("advice") or []) if str(item).strip()]
    ) or _fallback_advice(rule_analysis, risk_level)

    need_manual_review = _safe_bool(
        llm_payload.get("need_manual_review"),
        confidence < settings.detection_manual_review_confidence_threshold,
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
            "retrieval": retrieval_bundle.to_json(),
            "llm_output": llm_payload,
            "composite_score": composite_score,
        },
    }

    return DetectionAnalysis(
        rule_score=rule_analysis.rule_score,
        retrieval_query=retrieval_bundle.query_text,
        llm_model=llm_model,
        result_payload=result_payload,
    )
