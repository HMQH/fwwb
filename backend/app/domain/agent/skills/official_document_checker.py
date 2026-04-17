from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.tools.ocr_tool import extract_texts
from app.domain.agent.types import EvidenceItem, SkillResult
from app.domain.detection import llm
from app.shared.observability.langsmith import traceable

_DOC_TITLE_PATTERNS = (
    "\u4f20\u7968",
    "\u8d77\u8bc9",
    "\u7acb\u6848",
    "\u5e94\u8bc9",
    "\u62d8\u4f20",
    "\u6267\u884c\u901a\u77e5",
    "\u884c\u653f\u5904\u7f5a",
    "\u5904\u7f5a\u51b3\u5b9a",
    "\u534f\u67e5",
    "\u901a\u544a",
    "\u516c\u544a",
    "\u901a\u77e5\u4e66",
    "\u50ac\u544a",
    "\u51bb\u7ed3",
)
_OFFICIAL_ISSUER_PATTERNS = (
    "\u4eba\u6c11\u6cd5\u9662",
    "\u6cd5\u9662",
    "\u68c0\u5bdf\u9662",
    "\u516c\u5b89\u5c40",
    "\u6d3e\u51fa\u6240",
    "\u4eba\u6c11\u653f\u5e9c",
    "\u5e02\u653f\u5e9c",
    "\u533a\u653f\u5e9c",
    "\u7a0e\u52a1\u5c40",
    "\u76d1\u7ba1\u5c40",
    "\u53f8\u6cd5\u5c40",
    "\u4ef2\u88c1\u59d4",
    "\u884c\u653f\u6267\u6cd5",
)
_HIGH_RISK_ACTION_PATTERNS = (
    "\u4e0b\u8f7dAPP",
    "\u4e0b\u8f7dapp",
    "\u70b9\u51fb\u94fe\u63a5",
    "\u626b\u63cf\u4e8c\u7ef4\u7801",
    "\u626b\u7801",
    "\u52a0\u5fae\u4fe1",
    "\u8054\u7cfb\u5ba2\u670d",
    "\u8f6c\u8d26",
    "\u6c47\u6b3e",
    "\u7f34\u8d39",
    "\u4fdd\u8bc1\u91d1",
    "\u9a8c\u8bc1\u7801",
    "\u94f6\u884c\u5361",
)
_PRESSURE_PATTERNS = (
    "\u7acb\u5373\u5904\u7406",
    "\u7acb\u5373\u7f34\u7eb3",
    "\u4eca\u65e5\u5185",
    "\u4eca\u5929\u5185",
    "24\u5c0f\u65f6\u5185",
    "\u9650\u671f\u5904\u7406",
    "\u903e\u671f",
    "\u5426\u5219",
)
_PRIVATE_CONTACT_PATTERNS = (
    re.compile(r"(?i)https?://"),
    re.compile(r"(?i)(?:vx|v\u4fe1|\u5fae\u4fe1|wechat|qq)[:\uff1a ]?[A-Za-z0-9_-]{4,}"),
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
)
_DOC_NUMBER_PATTERNS = (
    re.compile(r"[\(\uff08][0-9]{4}[\)\uff09].{0,10}\u53f7"),
    re.compile(r"\u6848\u53f7[:\uff1a ]?[A-Za-z0-9\-\uff08\uff09()\u7b2c\u53f7]{6,}"),
    re.compile(r"\u6587\u53f7[:\uff1a ]?[A-Za-z0-9\-\uff08\uff09()\u7b2c\u53f7]{4,}"),
)
_DATE_PATTERN = re.compile(r"20\d{2}[\u5e74\-/.] ?\d{1,2}[\u6708\-/.] ?\d{1,2}\u65e5?")


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def _collect_text(state: AgentState) -> tuple[str, dict[str, Any]]:
    direct_text = _normalize_text(state.get("text_content"))
    ocr_result = state.get("ocr_result") or {}
    raw_payload = ocr_result.get("raw") if isinstance(ocr_result, dict) else None
    if isinstance(raw_payload, dict):
        aggregated = _normalize_text(raw_payload.get("aggregated_text"))
        provider = _normalize_text(raw_payload.get("provider")) or None
        if aggregated:
            merged = aggregated if not direct_text else f"{direct_text}\n\n[OCR]\n{aggregated}"
            return merged, {
                "provider": provider,
                "source": "ocr_result",
                "has_direct_text": bool(direct_text),
            }

    fallback = extract_texts(image_paths=state.get("image_paths", []), fallback_text=state.get("text_content"))
    aggregated = _normalize_text(fallback.get("aggregated_text"))
    return aggregated, {
        "provider": _normalize_text(fallback.get("provider")) or None,
        "source": "ocr_tool_fallback",
        "has_direct_text": bool(direct_text),
    }


def _filename_hints(image_paths: list[str]) -> list[str]:
    hints: list[str] = []
    for item in image_paths:
        stem = Path(item).stem.replace("_", " ").replace("-", " ").strip()
        if stem:
            hints.append(stem)
    return hints


def _contains_any(text: str, phrases: tuple[str, ...]) -> list[str]:
    return [phrase for phrase in phrases if phrase and phrase in text]


def _regex_matches(text: str, patterns: tuple[re.Pattern[str], ...]) -> list[str]:
    matches: list[str] = []
    for pattern in patterns:
        found = pattern.search(text)
        if found:
            matches.append(found.group(0))
    return matches


def _heuristic_analysis(text: str, *, filename_hints: list[str]) -> dict[str, Any]:
    normalized_text = text.replace(" ", "")
    joined_hints = " ".join(filename_hints)
    score = 0.0
    labels: list[str] = []
    evidence: list[EvidenceItem] = []
    recommendations: list[str] = []

    title_hits = _contains_any(normalized_text, _DOC_TITLE_PATTERNS)
    issuer_hits = _contains_any(normalized_text, _OFFICIAL_ISSUER_PATTERNS)
    action_hits = _contains_any(normalized_text, _HIGH_RISK_ACTION_PATTERNS)
    pressure_hits = _contains_any(normalized_text, _PRESSURE_PATTERNS)
    contact_hits = _regex_matches(text, _PRIVATE_CONTACT_PATTERNS)
    doc_number_hits = _regex_matches(text, _DOC_NUMBER_PATTERNS)
    date_hits = _regex_matches(text, (_DATE_PATTERN,))

    candidate_hint_words = ("\u6cd5\u9662", "\u653f\u5e9c", "\u901a\u77e5", "\u4f20\u7968", "\u516c\u6587")
    candidate = bool(title_hits or issuer_hits or any(word in joined_hints for word in candidate_hint_words))
    if candidate:
        score += 0.18
        labels.append("official_doc_candidate")
        evidence.append(
            EvidenceItem(
                skill="official_document_checker",
                title="公文样式线索",
                detail=f"抬头/落款线索：{', '.join((title_hits + issuer_hits)[:4]) or joined_hints[:80]}",
                severity="info",
            )
        )

    if issuer_hits and title_hits:
        score += 0.16
        labels.append("official_doc_authority_style")

    if action_hits:
        score += min(0.34, 0.12 + len(action_hits) * 0.06)
        labels.append("official_doc_suspicious_action")
        evidence.append(
            EvidenceItem(
                skill="official_document_checker",
                title="公文内出现高风险动作",
                detail=f"命中动作：{', '.join(action_hits[:4])}",
                severity="warning",
            )
        )
        recommendations.append(
            "凡是要求转账、下载应用、扫码或提交账号密码的“官方通知”，都要视为高风险。"
        )

    if contact_hits:
        score += min(0.26, 0.12 + len(contact_hits) * 0.05)
        labels.append("official_doc_private_contact")
        evidence.append(
            EvidenceItem(
                skill="official_document_checker",
                title="发现私人联系方式",
                detail=f"命中联系方式/链接：{', '.join(contact_hits[:3])}",
                severity="warning",
            )
        )
        recommendations.append(
            "只使用机构公开官网或热线核验，不要联系图中的私人手机号、QQ 或微信。"
        )

    if pressure_hits:
        score += min(0.18, len(pressure_hits) * 0.05)
        labels.append("official_doc_pressure_language")
        evidence.append(
            EvidenceItem(
                skill="official_document_checker",
                title="命中施压催促语",
                detail=f"命中催促语：{', '.join(pressure_hits[:4])}",
                severity="warning",
            )
        )

    if candidate and not doc_number_hits:
        score += 0.08
        labels.append("official_doc_missing_case_number")
        evidence.append(
            EvidenceItem(
                skill="official_document_checker",
                title="缺少正式文号",
                detail="文字看起来像正式通知，但没有识别到清晰案号或文号。",
                severity="warning",
            )
        )

    if candidate and not date_hits:
        score += 0.05
        labels.append("official_doc_missing_date")

    suspicious_forgery = bool(candidate and (action_hits or contact_hits or pressure_hits or (not doc_number_hits and not date_hits)))
    if suspicious_forgery:
        labels.append("forged_official_document_suspected")
        recommendations.append("在采取任何动作前，先通过机构公开热线或官网核验文书真伪。")
        recommendations.append("先保留截图，不要扫码、点链接或缴费，确认真伪后再处理。")

    summary = "未发现明显公文仿冒线索。"
    if candidate and suspicious_forgery:
        summary = "图片疑似仿冒公文，并包含常见伪造通知线索。"
    elif candidate:
        summary = "图片看起来像正式通知，但当前识别文字中的可疑线索有限。"

    return {
        "candidate": candidate,
        "suspicious_forgery": suspicious_forgery,
        "score": round(min(score, 0.95), 3),
        "labels": labels,
        "evidence": evidence,
        "recommendations": recommendations,
        "summary": summary,
        "title_hits": title_hits,
        "issuer_hits": issuer_hits,
        "action_hits": action_hits,
        "pressure_hits": pressure_hits,
        "contact_hits": contact_hits,
        "doc_number_hits": doc_number_hits,
        "date_hits": date_hits,
    }


def _build_llm_payload(text: str) -> dict[str, Any] | None:
    if not text or len(text) < 18:
        return None
    try:
        client = llm.build_chat_json_client()
    except Exception:
        return None

    system_prompt = "你要审核图片 OCR 文本，判断它是否疑似仿冒公文骗局。只返回严格 JSON，summary 和 suspicious_points 必须使用中文。"
    user_prompt = (
        "请分析下面的 OCR 文本，判断它是否在模仿法院传票、政府通知、行政文书或其他正式公文，"
        "并识别其中是否存在诈骗或伪造线索。\n\n"
        "返回 JSON，字段必须包含：is_official_document_candidate（bool）、suspicious_forgery（bool）、"
        "doc_type（string）、risk_score（0-1 number）、suspicious_points（array of strings）、"
        "summary（string）、labels（array of strings）、need_manual_review（bool）。\n\n"
        f"OCR 文本：\n{text[:2400]}"
    )
    try:
        response = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
    except Exception:
        return None

    payload = dict(response.payload or {})
    payload["llm_model"] = response.model_name
    return payload


@traceable(name="agent.skill.official_document_checker", run_type="chain")
def run_official_document_checker(state: AgentState) -> dict[str, object]:
    text, input_meta = _collect_text(state)
    filename_hints = _filename_hints(state.get("image_paths", []))
    heuristic = _heuristic_analysis(text, filename_hints=filename_hints)
    llm_payload = _build_llm_payload(text)

    result = SkillResult(
        name="official_document_checker",
        summary=heuristic["summary"],
        raw={
            "input_text": text,
            "input_meta": input_meta,
            "filename_hints": filename_hints,
            "heuristic": {
                key: value
                for key, value in heuristic.items()
                if key not in {"evidence", "recommendations"}
            },
            "llm_review": llm_payload,
        },
    )

    llm_score = 0.0
    if isinstance(llm_payload, dict):
        try:
            llm_score = max(0.0, min(0.99, float(llm_payload.get("risk_score") or 0.0)))
        except (TypeError, ValueError):
            llm_score = 0.0

    result.risk_score = round(max(float(heuristic["score"]), llm_score), 3)
    label_groups = [*heuristic["labels"]]
    if isinstance(llm_payload, dict):
        label_groups.extend(str(item).strip() for item in list(llm_payload.get("labels") or []) if str(item).strip())
    result.labels = list(dict.fromkeys(label_groups))
    result.evidence.extend(list(heuristic["evidence"]))
    result.recommendations.extend(list(dict.fromkeys(heuristic["recommendations"])))

    if isinstance(llm_payload, dict):
        suspicious_points = [str(item).strip() for item in list(llm_payload.get("suspicious_points") or []) if str(item).strip()]
        for point in suspicious_points[:4]:
            result.evidence.append(
                EvidenceItem(
                    skill="official_document_checker",
                    title="模型复核线索",
                    detail=point,
                    severity="warning",
                )
            )
        if suspicious_points:
            result.recommendations.append(
                "如果通知自称法院、公安或政府部门，请通过公开渠道核验，不要直接相信图片中的联系方式。"
            )

    result.triggered = bool(heuristic["candidate"] or result.risk_score >= 0.22)

    if isinstance(llm_payload, dict) and str(llm_payload.get("summary") or "").strip():
        result.summary = str(llm_payload.get("summary")).strip()
    elif heuristic["candidate"] and not text:
        result.summary = "图片文件名提示它可能是正式通知，但当前文字不足以深入核验。"

    if not text and not filename_hints:
        result.summary = "当前没有可用文字或文件名线索，暂无法完成公文核验。"
        result.triggered = False
        result.risk_score = 0.0

    return {"official_document_result": result.to_dict()}
