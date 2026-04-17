from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

from app.domain.agent.state import AgentState
from app.domain.agent.tools.qr_rule_loader import QRDomainRule, QRKeywordRule, load_qr_domain_rules, load_qr_keyword_rules
from app.domain.agent.tools.qr_tool import decode_qr_codes
from app.domain.agent.types import EvidenceItem, SkillResult
from app.domain.detection.web_phishing_predictor import predict_from_url_only
from app.shared.observability.langsmith import traceable


DOMAIN_WITH_OPTIONAL_PATH_RE = re.compile(
    r"^(?P<host>(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d{1,5})?(?P<path>/[^\s]*)?$"
)
IP_WITH_OPTIONAL_PATH_RE = re.compile(
    r"^(?P<host>(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?P<path>/[^\s]*)?$"
)

URL_MODEL_FEATURE_CLUES: dict[str, str] = {
    "URL_length": "链接长度异常",
    "URL_IP": "链接直接使用 IP 地址",
    "URL_redirect": "链接中存在跳转痕迹",
    "URL_shortener": "使用短链接跳转",
    "URL_subdomains": "子域层级过多",
    "URL_at": "链接包含 @ 符号",
    "URL_dash": "域名包含异常连字符",
    "URL_checkPathExtend": "路径疑似伪装扩展名",
    "URL_checkPunycode": "疑似同形字域名",
    "URL_checkSensitiveWord": "链接包含高危敏感词",
    "URL_checkTLDinPath": "路径中伪装域名后缀",
    "URL_checkTLDinSub": "子域名中伪装顶级域",
    "URL_checkStatisticRe": "结构特征异常",
    "REP_abnormal": "域名登记信息异常",
    "REP_ports": "使用非常规端口",
    "REP_SSL": "证书状态异常",
    "url_unicode": "链接包含异常字符",
}


def _normalize_host(host: str) -> str:
    return host.strip().lower().split(":", 1)[0]


def _is_ip_host(host: str) -> bool:
    try:
        ipaddress.ip_address(_normalize_host(host))
        return True
    except ValueError:
        return False


def _looks_like_url_candidate(payload: str) -> str | None:
    value = str(payload or "").strip()
    if not value:
        return None

    if value.startswith(("http://", "https://")):
        parsed = urlparse(value)
        return value if parsed.netloc else None

    if DOMAIN_WITH_OPTIONAL_PATH_RE.match(value):
        return f"http://{value}"

    if IP_WITH_OPTIONAL_PATH_RE.match(value):
        host = value.split("/", 1)[0].split(":", 1)[0]
        if _is_ip_host(host):
            return f"http://{value}"

    return None


def _match_domain_rule(host: str, rules: list[QRDomainRule]) -> QRDomainRule | None:
    normalized = _normalize_host(host)
    for rule in sorted(rules, key=lambda item: item.priority):
        pattern = str(rule.pattern or "").strip().lower()
        if not pattern:
            continue
        if rule.match_type == "exact" and normalized == pattern:
            return rule
        if rule.match_type == "suffix" and (normalized == pattern or normalized.endswith(f".{pattern}")):
            return rule
        if rule.match_type == "contains" and pattern in normalized:
            return rule
    return None


def _contains_sensitive_keyword(value: str, rules: list[QRKeywordRule]) -> tuple[bool, list[str], float]:
    normalized = str(value or "").strip().lower()
    matched_keywords: list[str] = []
    added_weight = 0.0
    for rule in sorted(rules, key=lambda item: item.priority):
        keyword = str(rule.keyword or "").strip().lower()
        if not keyword or keyword not in normalized:
            continue
        matched_keywords.append(keyword)
        added_weight += float(rule.risk_weight or 0.0)
    return bool(matched_keywords), matched_keywords, added_weight


def _describe_payload(
    payload: str,
    normalized_url: str | None,
    domain_rules: list[QRDomainRule],
) -> tuple[str, str, dict[str, str | None]]:
    if normalized_url:
        parsed = urlparse(normalized_url)
        host = _normalize_host(parsed.netloc)
        matched_rule = _match_domain_rule(host, domain_rules)
        destination_kind = matched_rule.category if matched_rule else ("ip_host" if _is_ip_host(host) else "generic")
        destination_label = matched_rule.display_name if matched_rule else ("IP 直连站点" if _is_ip_host(host) else "普通网站")
        detail = f"二维码指向 {destination_label}，域名 {host}"
        if normalized_url != payload:
            detail += f"（已规范化为 {normalized_url}）"
        return (
            "二维码链接已识别",
            detail,
            {
                "payload_type": "url",
                "host": host,
                "destination_kind": destination_kind,
                "destination_label": destination_label,
                "normalized_url": normalized_url,
            },
        )

    if payload.lower().startswith(("wxp://", "alipays://")):
        scheme = payload.split("://", 1)[0].lower()
        scheme_label = "微信支付链接" if scheme == "wxp" else "支付宝支付链接"
        return (
            "二维码支付链接已识别",
            f"二维码对应 {scheme_label}",
            {
                "payload_type": "payment_scheme",
                "destination_kind": "payment_scheme",
                "destination_label": scheme_label,
                "normalized_url": None,
            },
        )

    return (
        "二维码文本已识别",
        f"二维码内容为文本：{payload[:80]}",
        {
            "payload_type": "text",
            "destination_kind": "text",
            "destination_label": "文本内容",
            "normalized_url": None,
        },
    )


def _localize_model_level(level: str, *, is_phishing: bool = False) -> str:
    normalized = str(level or "").strip().lower()
    if normalized == "high":
        return "高风险"
    if normalized == "medium":
        return "中风险"
    if normalized == "suspicious":
        return "可疑"
    if normalized == "safe":
        return "安全" if not is_phishing else "可疑"
    return "待核验"


def _score_from_local_prediction(level: str, *, is_phishing: bool, phish_prob: float) -> float:
    normalized = str(level or "").strip().lower()
    probability = max(0.0, min(1.0, float(phish_prob or 0.0)))
    if normalized == "high":
        return max(0.88, probability)
    if normalized == "medium":
        return max(0.72, probability)
    if normalized == "suspicious":
        return max(0.58, probability)
    if is_phishing:
        return max(0.62, probability)
    if probability >= 0.45:
        return max(0.48, probability)
    return max(0.0, probability * 0.4)


def _extract_model_clues(features: object) -> list[str]:
    if not isinstance(features, dict):
        return []

    clues: list[str] = []
    for key, label in URL_MODEL_FEATURE_CLUES.items():
        try:
            numeric = float(features.get(key) or 0.0)
        except (TypeError, ValueError):
            continue
        if numeric > 0 and label not in clues:
            clues.append(label)
    return clues[:4]


@traceable(name="agent.skill.qr_inspector", run_type="chain")
def run_qr_inspector(state: AgentState) -> dict[str, object]:
    image_paths = state.get("image_paths", [])
    scan = decode_qr_codes(image_paths)
    matches = list(scan.get("matches", []))
    warnings = list(scan.get("warnings", []))
    domain_rules, domain_warnings = load_qr_domain_rules()
    keyword_rules, keyword_warnings = load_qr_keyword_rules()
    warnings.extend(domain_warnings)
    warnings.extend(keyword_warnings)

    result = SkillResult(name="qr_inspector", summary="未检测到二维码。")
    if not matches:
        if warnings:
            result.raw["warnings"] = warnings
        return {"qr_result": result.to_dict()}

    result.triggered = True
    result.summary = "已识别提交图片中的二维码内容。"
    result.raw["decoded_matches"] = matches
    result.raw["rule_sources"] = {
        "domain_rule_count": len(domain_rules),
        "keyword_rule_count": len(keyword_rules),
    }

    max_score = 0.3
    url_predictions: list[dict[str, object]] = []

    for item in matches:
        payload = str(item.get("payload", "")).strip()
        normalized_url = _looks_like_url_candidate(payload)
        evidence_title, evidence_detail, evidence_extra = _describe_payload(payload, normalized_url, domain_rules)
        risk_score = 0.2
        labels: list[str] = ["qr_code_detected"]

        if normalized_url:
            parsed = urlparse(normalized_url)
            risk_score += 0.2
            labels.append("qr_contains_link")
            if normalized_url != payload:
                labels.append("qr_link_normalized")

            host = _normalize_host(parsed.netloc)
            matched_rule = _match_domain_rule(host, domain_rules)
            if matched_rule:
                labels.append(f"qr_points_to_{matched_rule.category}_site")
                risk_score += float(matched_rule.risk_weight or 0.0)
            elif _is_ip_host(host):
                risk_score += 0.2
                labels.append("qr_points_to_ip_host")

            has_sensitive_keyword, matched_keywords, keyword_weight = _contains_sensitive_keyword(normalized_url, keyword_rules)
            if has_sensitive_keyword:
                risk_score += keyword_weight
                labels.append("qr_link_has_sensitive_action")

            try:
                prediction = predict_from_url_only(normalized_url, return_features=True)
            except Exception as exc:  # pragma: no cover - runtime environment dependent
                prediction = None
                warnings.append(f"本地网址模型检测失败：{exc}")

            if isinstance(prediction, dict):
                risk_level = str(prediction.get("risk_level") or "").strip().lower()
                model_name = str(prediction.get("model_name") or "").strip() or "本地网址模型"
                is_phishing = bool(prediction.get("is_phishing"))
                try:
                    phish_prob = float(prediction.get("phish_prob") or 0.0)
                except (TypeError, ValueError):
                    phish_prob = 0.0
                clues = _extract_model_clues(prediction.get("features"))
                localized_level = _localize_model_level(risk_level, is_phishing=is_phishing)
                model_score = _score_from_local_prediction(risk_level, is_phishing=is_phishing, phish_prob=phish_prob)
                risk_score = max(risk_score, model_score)
                labels.append(f"qr_local_url_{risk_level or ('suspicious' if is_phishing else 'safe')}")

                prediction_record = {
                    "url": str(prediction.get("url") or normalized_url),
                    "model_name": model_name,
                    "risk_level": risk_level,
                    "is_phishing": is_phishing,
                    "phish_prob": round(phish_prob, 4),
                    "confidence": round(float(prediction.get("confidence") or phish_prob), 4),
                    "clues": clues,
                }
                url_predictions.append(prediction_record)

                detail_parts = [
                    f"判定：{localized_level}",
                    f"钓鱼概率：{round(phish_prob * 100)}%",
                ]
                if matched_keywords:
                    detail_parts.append(f"命中关键词：{', '.join(matched_keywords[:4])}")
                if clues:
                    detail_parts.append(f"命中线索：{'、'.join(clues)}")
                result.evidence.append(
                    EvidenceItem(
                        skill="qr_inspector",
                        title="本地网址风险识别",
                        detail=" | ".join(detail_parts),
                        severity="warning" if risk_level in {"high", "medium", "suspicious"} or is_phishing else "info",
                        source_path=str(item.get("source_path") or ""),
                        extra={
                            "original_payload": payload,
                            "normalized_url": normalized_url,
                            "risk_level": risk_level,
                            "model_name": model_name,
                            "clues": clues,
                        },
                    )
                )

        elif payload.lower().startswith(("wxp://", "alipays://")):
            risk_score += 0.2
            labels.append("qr_payment_scheme")

        max_score = max(max_score, min(risk_score, 1.0))
        for label in labels:
            if label not in result.labels:
                result.labels.append(label)
        result.evidence.append(
            EvidenceItem(
                skill="qr_inspector",
                title=evidence_title,
                detail=evidence_detail,
                severity="warning" if risk_score >= 0.5 else "info",
                source_path=str(item.get("source_path") or ""),
                extra={
                    **evidence_extra,
                    "payload": payload,
                },
            )
        )

    result.risk_score = round(max_score, 3)
    if url_predictions:
        result.raw["url_predictions"] = url_predictions
        result.summary = "二维码含链接，已通过本地网址模型完成风险识别。"
    if result.risk_score >= 0.5:
        result.recommendations.append("先核验二维码跳转的网址和用途，再决定是否打开。")
    if any(
        str(item.get("risk_level") or "").lower() in {"high", "medium", "suspicious"} or bool(item.get("is_phishing"))
        for item in url_predictions
    ):
        result.recommendations.append("本地模型提示该网址存在钓鱼风险，请勿在含真实账号的设备上直接打开。")
    if warnings:
        result.raw["warnings"] = warnings

    return {"qr_result": result.to_dict()}
