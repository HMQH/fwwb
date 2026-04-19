from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection.llm import build_chat_json_client
from app.domain.guardian_reports import repository
from app.domain.guardian_reports.entity import GuardianSafetyReport, GuardianSafetyReportAction, GuardianSafetyReportReceipt
from app.domain.user import repository as user_repository
from app.domain.user.entity import User

_LOCAL_TIMEZONE = ZoneInfo("Asia/Shanghai")
_REPORT_TYPES = {"day", "month", "year"}
_ACTION_TYPES = {"call", "message", "review", "training", "checklist", "monitor"}
_ACTION_PRIORITIES = {"high", "medium", "low"}
_ACTION_STATUSES = {"pending", "in_progress", "completed", "skipped"}
_RISK_LEVELS = {"low", "medium", "high"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _strip(value: Any, *, limit: int | None = None) -> str:
    text = str(value or "").strip()
    if limit is not None:
        text = text[:limit].strip()
    return text


def _to_float(value: Any, *, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _to_int(value: Any, *, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _risk_level(value: Any) -> str:
    normalized = _strip(value, limit=12).lower()
    if normalized in _RISK_LEVELS:
        return normalized
    return "low"


def _report_type(value: str) -> str:
    normalized = _strip(value, limit=12).lower()
    if normalized not in _REPORT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="报告类型无效")
    return normalized


def _resolve_target_ward_user_id(
    db: Session,
    *,
    current_user: User,
    ward_user_id: uuid.UUID | None,
) -> uuid.UUID:
    if ward_user_id is None:
        return current_user.id
    if ward_user_id == current_user.id:
        return ward_user_id
    if repository.is_user_guardian_for_ward(
        db,
        ward_user_id=ward_user_id,
        user_id=current_user.id,
        phone=current_user.phone,
    ):
        return ward_user_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限查看该被监护人的报告")


def _period_bounds(report_type: str, target_date: date | None) -> tuple[datetime, datetime, str]:
    anchor = target_date or datetime.now(_LOCAL_TIMEZONE).date()
    if report_type == "day":
        start_local = datetime(anchor.year, anchor.month, anchor.day, tzinfo=_LOCAL_TIMEZONE)
        end_local = start_local + timedelta(days=1)
        label = f"{anchor.year}-{anchor.month:02d}-{anchor.day:02d} 日报"
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), label

    if report_type == "month":
        start_local = datetime(anchor.year, anchor.month, 1, tzinfo=_LOCAL_TIMEZONE)
        if anchor.month == 12:
            end_local = datetime(anchor.year + 1, 1, 1, tzinfo=_LOCAL_TIMEZONE)
        else:
            end_local = datetime(anchor.year, anchor.month + 1, 1, tzinfo=_LOCAL_TIMEZONE)
        label = f"{anchor.year}-{anchor.month:02d} 月报"
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), label

    start_local = datetime(anchor.year, 1, 1, tzinfo=_LOCAL_TIMEZONE)
    end_local = datetime(anchor.year + 1, 1, 1, tzinfo=_LOCAL_TIMEZONE)
    label = f"{anchor.year} 年报"
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), label


def _bucket_key(value: datetime, report_type: str) -> str:
    if report_type == "day":
        return value.strftime("%Y-%m-%d-%H")
    if report_type == "month":
        return value.strftime("%Y-%m-%d")
    return value.strftime("%Y-%m")


def _bucket_label(value: datetime, report_type: str) -> str:
    if report_type == "day":
        return value.strftime("%H:00")
    if report_type == "month":
        return value.strftime("%m/%d")
    return value.strftime("%m月")


def _next_bucket_start(value: datetime, report_type: str) -> datetime:
    if report_type == "day":
        return value + timedelta(hours=1)
    if report_type == "month":
        return value + timedelta(days=1)
    if value.month == 12:
        return value.replace(year=value.year + 1, month=1, day=1)
    return value.replace(month=value.month + 1, day=1)


def _build_empty_points(*, report_type: str, start_at: datetime, end_at: datetime) -> tuple[list[dict[str, Any]], dict[str, int]]:
    points: list[dict[str, Any]] = []
    index_map: dict[str, int] = {}
    cursor = start_at.astimezone(_LOCAL_TIMEZONE)
    end_local = end_at.astimezone(_LOCAL_TIMEZONE)
    while cursor < end_local:
        key = _bucket_key(cursor, report_type)
        if key not in index_map:
            index_map[key] = len(points)
            points.append(
                {
                    "bucket_key": key,
                    "label": _bucket_label(cursor, report_type),
                    "high": 0,
                    "medium": 0,
                    "low": 0,
                    "total": 0,
                }
            )
        cursor = _next_bucket_start(cursor, report_type)
    return points, index_map


def _extract_key_moments(result_detail: dict[str, Any], *, submission_id: uuid.UUID, result_id: uuid.UUID, created_at: datetime) -> list[dict[str, Any]]:
    payload = result_detail
    if isinstance(payload.get("audio_scam_insight"), dict):
        payload = payload["audio_scam_insight"]
    dynamics = payload.get("dynamics") if isinstance(payload, dict) else None
    if not isinstance(dynamics, dict):
        return []
    key_moments = dynamics.get("key_moments")
    if not isinstance(key_moments, list):
        return []

    items: list[dict[str, Any]] = []
    for index, item in enumerate(key_moments):
        if not isinstance(item, dict):
            continue
        label = _strip(item.get("label") or item.get("stage_label") or item.get("title"), limit=64)
        description = _strip(item.get("description") or item.get("summary"), limit=180)
        tone = _strip(item.get("tone"), limit=24).lower() or "info"
        if not label and not description:
            continue
        items.append(
            {
                "id": _strip(item.get("id"), limit=64) or f"{result_id}-moment-{index + 1}",
                "label": label or "关键时刻",
                "description": description or label or "关键时刻",
                "time_sec": round(max(0.0, _to_float(item.get("time_sec"), fallback=0.0)), 2),
                "tone": tone,
                "stage_label": _strip(item.get("stage_label"), limit=64) or None,
                "submission_id": str(submission_id),
                "result_id": str(result_id),
                "created_at": created_at.isoformat(),
            }
        )
    return items


def _build_aggregate_payload(
    *,
    report_type: str,
    period_start: datetime,
    period_end: datetime,
    rows: list[tuple[Any, Any]],
) -> dict[str, Any]:
    points, point_map = _build_empty_points(report_type=report_type, start_at=period_start, end_at=period_end)

    total_submissions = len(rows)
    total_results = 0
    risk_counts = {"high": 0, "medium": 0, "low": 0}
    fraud_counter: Counter[str] = Counter()
    stage_counter: Counter[str] = Counter()
    confidence_values: list[float] = []
    high_risk_cases: list[dict[str, Any]] = []
    key_moments: list[dict[str, Any]] = []

    rule_counter: dict[str, dict[str, Any]] = {}
    highlight_counter: dict[str, dict[str, Any]] = {}

    for submission, result in rows:
        if getattr(submission, "created_at", None) is not None:
            created_local = submission.created_at.astimezone(_LOCAL_TIMEZONE)
            bucket = point_map.get(_bucket_key(created_local, report_type))
            if bucket is not None:
                points[bucket]["total"] += 1

        if result is None:
            continue

        total_results += 1
        level = _risk_level(getattr(result, "risk_level", None))
        risk_counts[level] += 1

        if getattr(submission, "created_at", None) is not None:
            bucket = point_map.get(_bucket_key(submission.created_at.astimezone(_LOCAL_TIMEZONE), report_type))
            if bucket is not None:
                points[bucket][level] += 1

        fraud_type = _strip(getattr(result, "fraud_type", None), limit=40) or "未分类"
        fraud_counter[fraud_type] += 1

        for stage in list(getattr(result, "stage_tags", []) or []):
            tag = _strip(stage, limit=32)
            if tag:
                stage_counter[tag] += 1

        confidence = _to_float(getattr(result, "confidence", None), fallback=0.0)
        if confidence > 0:
            if confidence <= 1:
                confidence_values.append(confidence * 100.0)
            else:
                confidence_values.append(confidence)

        if level in {"high", "medium"}:
            high_risk_cases.append(
                {
                    "submission_id": str(submission.id),
                    "result_id": str(result.id),
                    "risk_level": level,
                    "fraud_type": _strip(result.fraud_type, limit=64) or None,
                    "summary": _strip(result.summary, limit=160) or "检测记录",
                    "final_reason": _strip(result.final_reason, limit=220) or None,
                    "confidence": round(confidence, 4) if confidence > 0 else None,
                    "created_at": result.created_at.isoformat() if result.created_at else submission.created_at.isoformat(),
                }
            )

        for item in list(getattr(result, "rule_hits", []) or []):
            if not isinstance(item, dict):
                continue
            name = _strip(item.get("name"), limit=64)
            explanation = _strip(item.get("explanation"), limit=180)
            if not name:
                continue
            bucket = rule_counter.setdefault(name, {"count": 0, "detail_counter": Counter(), "samples": []})
            bucket["count"] += 1
            if explanation:
                bucket["detail_counter"][explanation] += 1
            if explanation and explanation not in bucket["samples"]:
                bucket["samples"].append(explanation)

        for item in list(getattr(result, "input_highlights", []) or []):
            if not isinstance(item, dict):
                continue
            text = _strip(item.get("text"), limit=100)
            reason = _strip(item.get("reason"), limit=80)
            if not reason:
                continue
            bucket = highlight_counter.setdefault(reason, {"count": 0, "texts": []})
            bucket["count"] += 1
            if text and text not in bucket["texts"]:
                bucket["texts"].append(text)

        if isinstance(result.result_detail, dict):
            key_moments.extend(
                _extract_key_moments(
                    result.result_detail,
                    submission_id=submission.id,
                    result_id=result.id,
                    created_at=result.created_at or submission.created_at,
                )
            )

    weighted_score = (
        int(
            round(
                (risk_counts["high"] * 100 + risk_counts["medium"] * 65 + risk_counts["low"] * 25)
                / max(total_results, 1)
            )
        )
        if total_results
        else 0
    )
    if weighted_score >= 70:
        overall_risk_level = "high"
    elif weighted_score >= 40:
        overall_risk_level = "medium"
    else:
        overall_risk_level = "low"

    pie_total = max(total_results, 1)
    pie = [
        {"key": "high", "label": "高风险", "value": risk_counts["high"], "ratio": round(risk_counts["high"] / pie_total, 4), "color": "#E45757"},
        {"key": "medium", "label": "中风险", "value": risk_counts["medium"], "ratio": round(risk_counts["medium"] / pie_total, 4), "color": "#F0A43A"},
        {"key": "low", "label": "低风险", "value": risk_counts["low"], "ratio": round(risk_counts["low"] / pie_total, 4), "color": "#4D8BFF"},
    ]
    bar_items = [{"label": key, "value": value} for key, value in fraud_counter.most_common(8)]

    top_evidence: list[dict[str, Any]] = []
    for name, data in sorted(rule_counter.items(), key=lambda item: item[1]["count"], reverse=True)[:8]:
        detail_counter: Counter = data["detail_counter"]
        detail = detail_counter.most_common(1)[0][0] if detail_counter else ""
        samples = [sample for sample in data["samples"][:3] if sample]
        top_evidence.append(
            {"evidence_type": "rule_hit", "title": name, "count": int(data["count"]), "detail": detail, "samples": samples}
        )
    for reason, data in sorted(highlight_counter.items(), key=lambda item: item[1]["count"], reverse=True)[:8]:
        if len(top_evidence) >= 12:
            break
        texts = [text for text in data["texts"][:3] if text]
        top_evidence.append(
            {"evidence_type": "input_highlight", "title": reason, "count": int(data["count"]), "detail": texts[0] if texts else "", "samples": texts}
        )

    stage_total = sum(stage_counter.values())
    stage_trajectory = [
        {"stage": key, "count": value, "ratio": round(value / max(stage_total, 1), 4)}
        for key, value in stage_counter.most_common(12)
    ]

    tone_order = {"danger": 4, "peak": 3, "warning": 2, "info": 1}
    key_moments.sort(key=lambda item: (tone_order.get(item.get("tone") or "info", 0), item.get("time_sec") or 0), reverse=True)
    high_risk_cases.sort(key=lambda item: (1 if item.get("risk_level") == "high" else 0, item.get("created_at") or ""), reverse=True)

    completion_rate = round(total_results / max(total_submissions, 1), 4) if total_submissions else 0.0
    avg_confidence = round(sum(confidence_values) / max(len(confidence_values), 1), 2) if confidence_values else 0.0

    return {
        "overall_risk_level": overall_risk_level,
        "overall_risk_score": weighted_score,
        "total_submissions": total_submissions,
        "total_results": total_results,
        "high_count": risk_counts["high"],
        "medium_count": risk_counts["medium"],
        "low_count": risk_counts["low"],
        "metrics": {
            "total_submissions": total_submissions,
            "total_results": total_results,
            "completion_rate": completion_rate,
            "high_ratio": round(risk_counts["high"] / pie_total, 4),
            "medium_ratio": round(risk_counts["medium"] / pie_total, 4),
            "low_ratio": round(risk_counts["low"] / pie_total, 4),
            "avg_confidence": avg_confidence,
            "fraud_type_count": len(fraud_counter),
        },
        "charts": {"pie": pie, "line": {"points": points}, "bar": {"items": bar_items}},
        "top_evidence": top_evidence,
        "stage_trajectory": stage_trajectory,
        "key_moments": key_moments[:24],
        "high_risk_cases": high_risk_cases[:12],
    }


def _advice_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "risk_overview": {"type": "string"},
            "key_findings": {"type": "array", "items": {"type": "string"}},
            "anomaly_notes": {"type": "array", "items": {"type": "string"}},
            "actionable_advice": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "action_type": {"type": "string", "enum": ["call", "message", "review", "training", "checklist", "monitor"]},
                    },
                    "required": ["title", "detail", "priority", "action_type"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["title", "summary", "risk_overview", "key_findings", "anomaly_notes", "actionable_advice"],
        "additionalProperties": False,
    }


def _fallback_llm_report(*, period_label: str, report_type: str, aggregate: dict[str, Any]) -> dict[str, Any]:
    high_count = _to_int(aggregate.get("high_count"))
    medium_count = _to_int(aggregate.get("medium_count"))
    low_count = _to_int(aggregate.get("low_count"))
    total_results = _to_int(aggregate.get("total_results"))
    level = _risk_level(aggregate.get("overall_risk_level"))
    score = _to_int(aggregate.get("overall_risk_score"))
    high_cases = list(aggregate.get("high_risk_cases") or [])
    key_findings = [
        f"周期内检测 {total_results} 条结果，高风险 {high_count} 条。",
        f"整体风险等级 {level.upper()}，风险分 {score}。",
        f"中风险 {medium_count} 条，低风险 {low_count} 条。",
    ]
    if high_cases:
        first_case = high_cases[0]
        key_findings.append(_strip(first_case.get("summary"), limit=80) or "存在重点风险记录")
    return {
        "title": f"{period_label} 安全监测报告",
        "summary": f"{report_type}周期已完成检测汇总，建议优先处理高风险与中风险记录。",
        "risk_overview": f"风险分 {score}，高/中/低分别为 {high_count}/{medium_count}/{low_count}。",
        "key_findings": [item for item in key_findings if item][:6],
        "anomaly_notes": [
            "重点关注高风险记录对应的欺诈类型集中现象。",
            "关注短时间内风险连续上升的趋势段。",
        ],
        "actionable_advice": [
            {"title": "优先回访高风险记录", "detail": "按高风险清单逐条回访，确认资金与账号状态。", "priority": "high", "action_type": "call"},
            {"title": "复核中风险阶段轨迹", "detail": "结合阶段轨迹与关键证据，确认是否升级为高风险。", "priority": "medium", "action_type": "review"},
            {"title": "补充反诈提醒", "detail": "针对高频欺诈类型补充简短提醒并持续监测。", "priority": "medium", "action_type": "monitor"},
        ],
    }


def _normalize_advice_items(raw_items: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    result: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        title = _strip(item.get("title"), limit=60)
        detail = _strip(item.get("detail"), limit=220)
        priority = _strip(item.get("priority"), limit=12).lower()
        action_type = _strip(item.get("action_type"), limit=20).lower()
        if priority not in _ACTION_PRIORITIES:
            priority = "medium"
        if action_type not in _ACTION_TYPES:
            action_type = "review"
        if not title and not detail:
            continue
        result.append(
            {
                "title": title or f"建议 {index + 1}",
                "detail": detail or title or "请结合报告处理风险",
                "priority": priority,
                "action_type": action_type,
            }
        )
    return result[:8]


def _generate_llm_report(
    *,
    report_type: str,
    period_label: str,
    aggregate: dict[str, Any],
) -> tuple[dict[str, Any], str | None, str]:
    compact_payload = {
        "overall_risk_level": aggregate.get("overall_risk_level"),
        "overall_risk_score": aggregate.get("overall_risk_score"),
        "metrics": aggregate.get("metrics"),
        "pie": aggregate.get("charts", {}).get("pie"),
        "line_tail": list((aggregate.get("charts", {}).get("line", {}).get("points") or [])[-12:]),
        "bar": aggregate.get("charts", {}).get("bar"),
        "top_evidence": list(aggregate.get("top_evidence") or [])[:10],
        "stage_trajectory": list(aggregate.get("stage_trajectory") or [])[:10],
        "key_moments": list(aggregate.get("key_moments") or [])[:8],
        "high_risk_cases": list(aggregate.get("high_risk_cases") or [])[:6],
    }

    try:
        client = build_chat_json_client()
        response = client.complete_json(
            system_prompt=(
                "你是反诈安全监测报告专家。"
                "请基于结构化检测统计，生成简洁、可执行、可落地的监护人报告。"
                "必须只输出 JSON。"
            ),
            user_prompt=(
                f"报告周期类型：{report_type}\n"
                f"报告周期：{period_label}\n"
                "请基于以下统计数据输出报告：\n"
                f"{json.dumps(compact_payload, ensure_ascii=False)}\n\n"
                "输出要求：\n"
                "1) summary 与 risk_overview 要直接给结论；\n"
                "2) key_findings 聚焦风险结构、变化趋势、高频欺诈类型；\n"
                "3) actionable_advice 要可执行，不能空泛。\n"
            ),
            output_schema=_advice_schema(),
            schema_name="guardian_safety_report",
        )
        payload = response.payload if isinstance(response.payload, dict) else {}
        llm_report = {
            "title": _strip(payload.get("title"), limit=80) or f"{period_label} 安全监测报告",
            "summary": _strip(payload.get("summary"), limit=240),
            "risk_overview": _strip(payload.get("risk_overview"), limit=240),
            "key_findings": [_strip(item, limit=120) for item in list(payload.get("key_findings") or []) if _strip(item, limit=120)][:8],
            "anomaly_notes": [_strip(item, limit=120) for item in list(payload.get("anomaly_notes") or []) if _strip(item, limit=120)][:8],
            "actionable_advice": _normalize_advice_items(payload.get("actionable_advice")),
        }
        if not llm_report["summary"] or not llm_report["risk_overview"] or not llm_report["actionable_advice"]:
            fallback = _fallback_llm_report(period_label=period_label, report_type=report_type, aggregate=aggregate)
            llm_report["summary"] = llm_report["summary"] or fallback["summary"]
            llm_report["risk_overview"] = llm_report["risk_overview"] or fallback["risk_overview"]
            llm_report["actionable_advice"] = llm_report["actionable_advice"] or fallback["actionable_advice"]
        return llm_report, response.model_name, "success"
    except Exception:
        fallback = _fallback_llm_report(period_label=period_label, report_type=report_type, aggregate=aggregate)
        return fallback, None, "fallback"


def _build_action_key(index: int, advice: dict[str, Any]) -> str:
    title = _strip(advice.get("title"), limit=24).lower().replace(" ", "-")
    title = "".join(ch for ch in title if ch.isalnum() or ch in {"-", "_"})
    if not title:
        title = f"advice-{index + 1}"
    return f"{index + 1}-{title}"[:64]


def _apply_report_actions(
    db: Session,
    *,
    report_id: uuid.UUID,
    advice_items: list[dict[str, Any]],
) -> None:
    repository.clear_actions_for_report(db, report_id=report_id)
    now = _utcnow()
    for index, advice in enumerate(advice_items):
        row = GuardianSafetyReportAction(
            report_id=report_id,
            action_key=_build_action_key(index, advice),
            action_label=_strip(advice.get("title"), limit=80) or f"建议 {index + 1}",
            action_detail=_strip(advice.get("detail"), limit=240) or None,
            action_type=_strip(advice.get("action_type"), limit=20).lower() or "review",
            priority=_strip(advice.get("priority"), limit=12).lower() or "medium",
            status="pending",
            due_at=now + timedelta(days=1 if _strip(advice.get("priority")).lower() == "high" else 3),
            payload={"source": "llm_report"},
        )
        repository.save_report_action_without_commit(db, row)
    db.commit()


def _apply_report_receipts(
    db: Session,
    *,
    report: GuardianSafetyReport,
) -> None:
    now = _utcnow()
    bindings = repository.list_active_bindings_for_ward(db, ward_user_id=report.ward_user_id)
    for binding in bindings:
        row = repository.get_receipt_for_report_binding(
            db,
            report_id=report.id,
            guardian_binding_id=binding.id,
        )
        if row is None:
            row = GuardianSafetyReportReceipt(
                report_id=report.id,
                guardian_binding_id=binding.id,
                guardian_user_id=binding.guardian_user_id,
                guardian_phone=binding.guardian_phone,
                delivery_channel="inapp",
                delivery_status="sent",
                sent_at=now,
            )
        else:
            row.guardian_user_id = binding.guardian_user_id
            row.guardian_phone = binding.guardian_phone
            row.delivery_channel = "inapp"
            row.delivery_status = "sent"
            row.sent_at = now
        db.add(row)
    report.sent_at = now if bindings else None
    report.status = "sent" if bindings else "generated"
    db.add(report)
    db.commit()
    db.refresh(report)


def _ward_snapshot(db: Session, *, ward_user_id: uuid.UUID) -> dict[str, Any]:
    ward = user_repository.get_by_id(db, ward_user_id)
    return {
        "ward_display_name": ward.display_name if ward else None,
        "ward_phone": ward.phone if ward else None,
    }


def _receipt_snapshots(
    db: Session,
    *,
    receipts: list[GuardianSafetyReportReceipt],
) -> list[dict[str, Any]]:
    binding_map = {
        row.id: row for row in repository.list_bindings_by_ids(db, binding_ids=[item.guardian_binding_id for item in receipts])
    }
    snapshots: list[dict[str, Any]] = []
    for row in receipts:
        binding = binding_map.get(row.guardian_binding_id)
        guardian_user = user_repository.get_by_id(db, row.guardian_user_id) if row.guardian_user_id else None
        snapshots.append(
            {
                "id": row.id,
                "report_id": row.report_id,
                "guardian_binding_id": row.guardian_binding_id,
                "guardian_user_id": row.guardian_user_id,
                "guardian_name": ((guardian_user.display_name if guardian_user else None) or (binding.guardian_name if binding else None) or None),
                "guardian_phone": row.guardian_phone or (binding.guardian_phone if binding else None),
                "delivery_channel": row.delivery_channel,
                "delivery_status": row.delivery_status,
                "sent_at": row.sent_at,
                "read_at": row.read_at,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
        )
    return snapshots


def _action_snapshots(actions: list[GuardianSafetyReportAction]) -> list[dict[str, Any]]:
    return [
        {
            "id": row.id,
            "report_id": row.report_id,
            "action_key": row.action_key,
            "action_label": row.action_label,
            "action_detail": row.action_detail,
            "action_type": row.action_type,
            "priority": row.priority,
            "status": row.status,
            "due_at": row.due_at,
            "completed_at": row.completed_at,
            "assignee_user_id": row.assignee_user_id,
            "payload": dict(row.payload or {}),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in actions
    ]


def _is_read_for_current_user(
    *,
    report: GuardianSafetyReport,
    receipts: list[GuardianSafetyReportReceipt],
    current_user: User,
) -> bool:
    if report.ward_user_id == current_user.id:
        return report.read_at is not None
    for row in receipts:
        if row.guardian_user_id == current_user.id or row.guardian_phone == current_user.phone:
            if row.read_at is not None or row.delivery_status == "read":
                return True
    return False


def _report_snapshot(
    db: Session,
    *,
    report: GuardianSafetyReport,
    current_user: User,
    include_detail: bool,
) -> dict[str, Any]:
    receipts = repository.list_receipts_for_report(db, report_id=report.id)
    actions = repository.list_actions_for_report(db, report_id=report.id) if include_detail else []
    ward = _ward_snapshot(db, ward_user_id=report.ward_user_id)
    payload = dict(report.payload or {})
    llm_report = payload.get("llm_report") if isinstance(payload.get("llm_report"), dict) else {}

    return {
        "id": report.id,
        "ward_user_id": report.ward_user_id,
        "ward_display_name": ward["ward_display_name"],
        "ward_phone": ward["ward_phone"],
        "creator_user_id": report.creator_user_id,
        "report_type": report.report_type,
        "period_start": report.period_start,
        "period_end": report.period_end,
        "period_label": report.period_label,
        "overall_risk_level": report.overall_risk_level,
        "overall_risk_score": report.overall_risk_score,
        "total_submissions": report.total_submissions,
        "total_results": report.total_results,
        "high_count": report.high_count,
        "medium_count": report.medium_count,
        "low_count": report.low_count,
        "status": report.status,
        "llm_model": report.llm_model,
        "llm_status": report.llm_status,
        "payload": payload if include_detail else {},
        "llm_title": _strip(llm_report.get("title"), limit=80) or None,
        "llm_summary": _strip(llm_report.get("summary"), limit=160) or None,
        "raw_aggregates": dict(report.raw_aggregates or {}) if include_detail else {},
        "read_at": report.read_at,
        "sent_at": report.sent_at,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        "is_read": _is_read_for_current_user(report=report, receipts=receipts, current_user=current_user),
        "receipts": _receipt_snapshots(db, receipts=receipts) if include_detail else [],
        "actions": _action_snapshots(actions),
    }


def _ensure_report_visible(
    db: Session,
    *,
    report: GuardianSafetyReport,
    current_user: User,
) -> None:
    if report.ward_user_id == current_user.id:
        return
    if repository.is_user_guardian_for_ward(
        db,
        ward_user_id=report.ward_user_id,
        user_id=current_user.id,
        phone=current_user.phone,
    ):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")


def generate_report(
    db: Session,
    *,
    current_user: User,
    report_type: str,
    ward_user_id: uuid.UUID | None = None,
    target_date: date | None = None,
    force_regenerate: bool = False,
) -> dict[str, Any]:
    normalized_type = _report_type(report_type)
    target_ward_user_id = _resolve_target_ward_user_id(
        db,
        current_user=current_user,
        ward_user_id=ward_user_id,
    )
    period_start, period_end, period_label = _period_bounds(normalized_type, target_date)

    existing = repository.get_report_by_period(
        db,
        ward_user_id=target_ward_user_id,
        report_type=normalized_type,
        period_start=period_start,
        period_end=period_end,
    )
    if existing is not None and not force_regenerate:
        return _report_snapshot(db, report=existing, current_user=current_user, include_detail=True)

    rows = repository.list_latest_submission_result_rows(
        db,
        ward_user_id=target_ward_user_id,
        start_at=period_start,
        end_at=period_end,
    )
    aggregate = _build_aggregate_payload(
        report_type=normalized_type,
        period_start=period_start,
        period_end=period_end,
        rows=rows,
    )
    llm_report, llm_model, llm_status = _generate_llm_report(
        report_type=normalized_type,
        period_label=period_label,
        aggregate=aggregate,
    )
    payload = {
        "period": {
            "report_type": normalized_type,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "period_label": period_label,
        },
        "metrics": dict(aggregate.get("metrics") or {}),
        "charts": dict(aggregate.get("charts") or {}),
        "top_evidence": list(aggregate.get("top_evidence") or []),
        "stage_trajectory": list(aggregate.get("stage_trajectory") or []),
        "key_moments": list(aggregate.get("key_moments") or []),
        "high_risk_cases": list(aggregate.get("high_risk_cases") or []),
        "llm_report": llm_report,
    }
    raw_aggregates = dict(aggregate)
    now = _utcnow()

    report = existing or GuardianSafetyReport(
        ward_user_id=target_ward_user_id,
        creator_user_id=current_user.id,
        report_type=normalized_type,
        period_start=period_start,
        period_end=period_end,
        period_label=period_label,
    )
    report.creator_user_id = current_user.id
    report.period_label = period_label
    report.overall_risk_level = _risk_level(aggregate.get("overall_risk_level"))
    report.overall_risk_score = _to_int(aggregate.get("overall_risk_score"))
    report.total_submissions = _to_int(aggregate.get("total_submissions"))
    report.total_results = _to_int(aggregate.get("total_results"))
    report.high_count = _to_int(aggregate.get("high_count"))
    report.medium_count = _to_int(aggregate.get("medium_count"))
    report.low_count = _to_int(aggregate.get("low_count"))
    report.status = "generated"
    report.llm_model = llm_model
    report.llm_status = llm_status
    report.payload = payload
    report.raw_aggregates = raw_aggregates
    report.read_at = None
    report.sent_at = now

    report = repository.save_report(db, report)
    _apply_report_actions(
        db,
        report_id=report.id,
        advice_items=list(llm_report.get("actionable_advice") or []),
    )
    _apply_report_receipts(db, report=report)
    return _report_snapshot(db, report=report, current_user=current_user, include_detail=True)


def list_reports(
    db: Session,
    *,
    current_user: User,
    report_type: str | None,
    ward_user_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    normalized_type = _report_type(report_type) if report_type else None
    if ward_user_id is not None:
        target_ward = _resolve_target_ward_user_id(db, current_user=current_user, ward_user_id=ward_user_id)
        ward_ids = [target_ward]
    else:
        ward_ids = repository.list_accessible_ward_ids(
            db,
            user_id=current_user.id,
            phone=current_user.phone,
        )
    rows = repository.list_reports_for_wards(
        db,
        ward_user_ids=ward_ids,
        report_type=normalized_type,
        limit=limit,
        offset=offset,
    )
    return [_report_snapshot(db, report=row, current_user=current_user, include_detail=False) for row in rows]


def get_report_detail(
    db: Session,
    *,
    current_user: User,
    report_id: uuid.UUID,
) -> dict[str, Any]:
    report = repository.get_report(db, report_id=report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")
    _ensure_report_visible(db, report=report, current_user=current_user)
    return _report_snapshot(db, report=report, current_user=current_user, include_detail=True)


def mark_report_read(
    db: Session,
    *,
    current_user: User,
    report_id: uuid.UUID,
) -> dict[str, Any]:
    report = repository.get_report(db, report_id=report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")
    _ensure_report_visible(db, report=report, current_user=current_user)
    now = _utcnow()
    if report.ward_user_id == current_user.id:
        report.read_at = now
        report.status = "read"
        report = repository.save_report(db, report)
        return _report_snapshot(db, report=report, current_user=current_user, include_detail=True)

    receipts = repository.list_receipts_for_guardian_on_report(
        db,
        report_id=report.id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if not receipts:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限操作该报告")
    for row in receipts:
        row.read_at = now
        row.delivery_status = "read"
        db.add(row)
    db.commit()
    if repository.count_unread_receipts(db, report_id=report.id) == 0:
        report.status = "read"
        db.add(report)
        db.commit()
    db.refresh(report)
    return _report_snapshot(db, report=report, current_user=current_user, include_detail=True)


def update_action_status(
    db: Session,
    *,
    current_user: User,
    report_id: uuid.UUID,
    action_id: uuid.UUID,
    status_value: str,
) -> dict[str, Any]:
    report = repository.get_report(db, report_id=report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")
    _ensure_report_visible(db, report=report, current_user=current_user)

    normalized_status = _strip(status_value, limit=20).lower()
    if normalized_status not in _ACTION_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="动作状态无效")
    action = repository.get_action_for_report(db, report_id=report.id, action_id=action_id)
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="动作不存在")
    action.status = normalized_status
    action.assignee_user_id = current_user.id
    action.completed_at = _utcnow() if normalized_status == "completed" else None
    repository.save_report_action(db, action)
    return _report_snapshot(db, report=report, current_user=current_user, include_detail=True)
