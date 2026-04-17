from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

from app.domain.agent.providers.threatbook_lookup import lookup_url_with_threatbook
from app.domain.agent.state import AgentState
from app.domain.agent.tools.qr_rule_loader import QRDomainRule, QRKeywordRule, load_qr_domain_rules, load_qr_keyword_rules
from app.domain.agent.tools.qr_tool import decode_qr_codes
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


DOMAIN_WITH_OPTIONAL_PATH_RE = re.compile(
    r"^(?P<host>(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d{1,5})?(?P<path>/[^\s]*)?$"
)
IP_WITH_OPTIONAL_PATH_RE = re.compile(
    r"^(?P<host>(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?P<path>/[^\s]*)?$"
)


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
        destination_label = matched_rule.display_name if matched_rule else ("IP 直连网站" if _is_ip_host(host) else "普通网站")
        detail = f"二维码对应 {destination_label}：{host}"
        if normalized_url != payload:
            detail += f"（已标准化为 {normalized_url}）"
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

    result = SkillResult(name="qr_inspector", summary="No QR code was detected.")
    if not matches:
        if warnings:
            result.raw["warnings"] = warnings
        return {"qr_result": result.to_dict()}

    result.triggered = True
    result.summary = "Decoded one or more QR codes from the submitted image set."
    result.raw["decoded_matches"] = matches
    result.raw["rule_sources"] = {
        "domain_rule_count": len(domain_rules),
        "keyword_rule_count": len(keyword_rules),
    }
    max_score = 0.3
    threatbook_results: list[dict[str, object]] = []

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
                if matched_rule.category == "shortener":
                    risk_score += float(matched_rule.risk_weight or 0.0)
            elif _is_ip_host(host):
                risk_score += 0.2
                labels.append("qr_points_to_ip_host")

            has_sensitive_keyword, matched_keywords, keyword_weight = _contains_sensitive_keyword(normalized_url, keyword_rules)
            if has_sensitive_keyword:
                risk_score += keyword_weight
                labels.append("qr_link_has_sensitive_action")

            threatbook = lookup_url_with_threatbook(normalized_url)
            threatbook_results.append(
                {
                    "original_payload": payload,
                    "query_url": normalized_url,
                    "status": threatbook.status,
                    "verdict": threatbook.verdict,
                    "summary": threatbook.summary,
                    "labels": list(threatbook.labels),
                    "warnings": list(threatbook.warnings),
                    "raw": dict(threatbook.raw),
                }
            )

            if threatbook.status == "completed":
                if threatbook.verdict == "malicious":
                    risk_score = max(risk_score, 0.92)
                    labels.append("qr_threatbook_malicious")
                elif threatbook.verdict == "suspicious":
                    risk_score = max(risk_score, 0.72)
                    labels.append("qr_threatbook_suspicious")
                elif threatbook.verdict == "benign":
                    labels.append("qr_threatbook_benign")
                elif threatbook.verdict == "unknown":
                    risk_score = max(risk_score, 0.55)
                    labels.append("qr_threatbook_unknown")
                else:
                    risk_score = max(risk_score, 0.55)
                    labels.append("qr_threatbook_no_verdict")

                detail_parts = [normalized_url]
                if matched_keywords:
                    detail_parts.append(f"命中关键词: {', '.join(matched_keywords[:4])}")
                if threatbook.summary:
                    detail_parts.append(str(threatbook.summary))
                result.evidence.append(
                    EvidenceItem(
                        skill="qr_inspector",
                        title="ThreatBook 威胁情报查询",
                        detail=" | ".join(detail_parts),
                        severity="warning" if threatbook.verdict in {"malicious", "suspicious"} else "info",
                        source_path=str(item.get("source_path") or ""),
                        extra={
                            "original_payload": payload,
                            "normalized_url": normalized_url,
                            "verdict": threatbook.verdict,
                            "labels": list(threatbook.labels),
                            "result_page_url": threatbook.raw.get("result_page_url"),
                        },
                    )
                )
            else:
                labels.append("qr_threatbook_lookup_unavailable")

            warnings.extend(list(threatbook.warnings))

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
    if threatbook_results:
        result.raw["threatbook"] = threatbook_results
    if result.risk_score >= 0.5:
        result.recommendations.append("Do not scan or open QR payloads until the destination is verified.")
    if any(item.get("verdict") in {"malicious", "suspicious"} for item in threatbook_results):
        result.recommendations.append(
            "ThreatBook marked the QR destination as risky. Avoid opening it on a device with real accounts."
        )
    if warnings:
        result.raw["warnings"] = warnings

    return {"qr_result": result.to_dict()}
