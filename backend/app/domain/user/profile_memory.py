"""用户画像 MEMORY.md 持久化与晋升逻辑。"""
from __future__ import annotations

import logging
import math
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.domain.assistant import repository as assistant_repository
from app.domain.assistant.entity import AssistantMessage, AssistantSession
from app.domain.detection import repository as detection_repository
from app.domain.detection.entity import DetectionResult, DetectionSubmission
from app.domain.detection.llm import build_chat_json_client
from app.domain.relations import repository as relation_repository
from app.domain.user import repository as user_repository
from app.domain.user.entity import User
from app.domain.user.profile_memory_prompts import (
    build_assistant_memory_assessment_prompts,
    build_detection_memory_assessment_prompts,
    build_profile_merge_prompts,
)
from app.shared.core.config import settings

logger = logging.getLogger(__name__)

_USER_ROLE_LABELS = {
    "child": "未成年人",
    "youth": "青年/成年人",
    "elder": "老年人",
}

_MEMORY_BUCKET_LABELS = {
    "risk_pattern": "风险模式",
    "communication_style": "沟通特征",
    "preference": "偏好习惯",
    "protection": "防护习惯",
    "relationship": "关系线索",
    "stability_signal": "稳定信号",
}

_RISK_KEYWORDS = (
    "转账",
    "打款",
    "验证码",
    "链接",
    "客服",
    "银行卡",
    "退款",
    "兼职",
    "刷单",
    "投资",
    "贷款",
    "领奖",
    "取现",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _write_utf8_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fp:
        fp.write(text)


def _read_utf8_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _memory_root() -> Path:
    root = Path(settings.user_memory_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _display_path(path: Path) -> str:
    root_parent = _memory_root().parent.resolve()
    try:
        return path.resolve().relative_to(root_parent).as_posix()
    except ValueError:
        return path.as_posix()


def get_user_memory_dir(user_id: uuid.UUID) -> Path:
    return _memory_root() / str(user_id)


def get_user_memory_path(user_id: uuid.UUID) -> Path:
    return get_user_memory_dir(user_id) / "MEMORY.md"


def get_user_daily_note_path(user_id: uuid.UUID, day: date) -> Path:
    return get_user_memory_dir(user_id) / "memory" / f"{day.isoformat()}.md"


def _clamp_int(value: Any, *, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(round(float(value)))
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, *, minimum: float, maximum: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _safe_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return fallback


def _clean_text(value: Any, *, max_length: int | None = None, fallback: str = "") -> str:
    normalized = " ".join(str(value or "").split())
    if not normalized:
        return fallback
    if max_length is not None and len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip("，。；;!！?？、 ")
        normalized = f"{normalized}…"
    return normalized


def _normalize_tags(values: Any, *, limit: int = 6) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    if not isinstance(values, list):
        return items
    for raw in values:
        cleaned = _clean_text(raw, max_length=20)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        items.append(cleaned)
        if len(items) >= limit:
            break
    return items


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _event_timestamp(value: Any) -> datetime:
    return _parse_datetime(value) or _utcnow()


def _relation_name(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
) -> str | None:
    if relation_profile_id is None:
        return None
    profile = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_profile_id,
    )
    if profile is None:
        return None
    return _clean_text(profile.name, max_length=24) or None


def _build_user_context_payload(user: User, *, memory_path: Path) -> dict[str, Any]:
    return {
        "display_name": user.display_name,
        "role": user.role,
        "role_label": _USER_ROLE_LABELS.get(user.role, user.role),
        "guardian_relation": user.guardian_relation,
        "current_safety_score": user.safety_score,
        "current_memory_urgency_score": user.memory_urgency_score,
        "memory_path": _display_path(memory_path),
        "profile_summary": user.profile_summary,
    }


def _extract_final_score(result: DetectionResult) -> int | None:
    detail = result.result_detail if isinstance(result.result_detail, dict) else {}
    value = detail.get("final_score")
    try:
        parsed = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, parsed))


def _extract_detection_profile_memory_snapshot(result: DetectionResult) -> dict[str, Any]:
    detail = result.result_detail if isinstance(result.result_detail, dict) else {}
    raw = detail.get("profile_memory")
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _extract_assistant_profile_memory_snapshot(message: AssistantMessage) -> dict[str, Any]:
    payload = message.extra_payload if isinstance(message.extra_payload, dict) else {}
    raw = payload.get("profile_memory")
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _build_detection_event_payload(
    db: Session,
    *,
    user_id: uuid.UUID,
    submission: DetectionSubmission,
    result: DetectionResult,
) -> dict[str, Any]:
    detail = result.result_detail if isinstance(result.result_detail, dict) else {}
    relation_name = _relation_name(
        db,
        user_id=user_id,
        relation_profile_id=submission.relation_profile_id,
    )
    final_score = _extract_final_score(result)
    summary = _clean_text(result.summary, max_length=120)
    fraud_type = _clean_text(result.fraud_type, max_length=24)
    title = _clean_text(
        fraud_type if fraud_type and fraud_type not in {"未知", "待人工复核"} else summary,
        max_length=24,
        fallback="检测画像观察",
    )
    risk_evidence = detail.get("risk_evidence") if isinstance(detail, dict) else []
    counter_evidence = detail.get("counter_evidence") if isinstance(detail, dict) else []
    return {
        "event_id": str(result.id),
        "source": "detection",
        "title": title,
        "created_at": result.created_at.isoformat() if result.created_at else None,
        "submission_id": str(submission.id),
        "relation_profile_id": str(submission.relation_profile_id) if submission.relation_profile_id else None,
        "relation_name": relation_name,
        "risk_level": result.risk_level,
        "fraud_type": fraud_type,
        "confidence": result.confidence,
        "need_manual_review": result.need_manual_review,
        "summary": summary,
        "final_reason": _clean_text(result.final_reason, max_length=180),
        "final_score": final_score,
        "hit_rules": _normalize_tags(list(result.hit_rules or []), limit=6),
        "stage_tags": _normalize_tags(list(result.stage_tags or []), limit=6),
        "risk_evidence": _normalize_tags(list(risk_evidence or []), limit=4),
        "counter_evidence": _normalize_tags(list(counter_evidence or []), limit=3),
        "advice": _normalize_tags(list(result.advice or []), limit=3),
        "text_preview": _clean_text(submission.text_content, max_length=160),
    }


def _attachment_names(extra_payload: dict[str, Any]) -> list[str]:
    attachments = extra_payload.get("attachments")
    items: list[str] = []
    seen: set[str] = set()
    if not isinstance(attachments, list):
        return items
    for item in attachments:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"), max_length=20)
        if not name or name in seen:
            continue
        seen.add(name)
        items.append(name)
        if len(items) >= 4:
            break
    return items


def _build_assistant_event_payload(
    *,
    session: AssistantSession,
    user_message: AssistantMessage,
    assistant_message: AssistantMessage,
    relation_name: str | None,
) -> dict[str, Any]:
    user_payload = user_message.extra_payload if isinstance(user_message.extra_payload, dict) else {}
    assistant_payload = assistant_message.extra_payload if isinstance(assistant_message.extra_payload, dict) else {}
    active_relation_name = relation_name or _clean_text(
        user_payload.get("active_relation_profile_name"),
        max_length=24,
    ) or None
    references = assistant_payload.get("references") if isinstance(assistant_payload.get("references"), list) else []
    reference_lines: list[str] = []
    for item in references[:3]:
        if not isinstance(item, dict):
            continue
        fraud_type = _clean_text(item.get("fraud_type"), max_length=18)
        sample_label = _clean_text(item.get("sample_label"), max_length=18)
        data_source = _clean_text(item.get("data_source"), max_length=18)
        parts = [part for part in (fraud_type, sample_label, data_source) if part]
        if parts:
            reference_lines.append(" / ".join(parts))
    user_text = _clean_text(user_message.content, max_length=180)
    assistant_text = _clean_text(assistant_message.content, max_length=180)
    title_seed = user_text or assistant_text or "助手对话画像观察"
    return {
        "event_id": str(assistant_message.id),
        "source": "assistant",
        "title": _clean_text(title_seed, max_length=24, fallback="助手对话画像观察"),
        "created_at": assistant_message.created_at.isoformat() if assistant_message.created_at else None,
        "session_id": str(session.id),
        "relation_profile_id": str(session.relation_profile_id) if session.relation_profile_id else None,
        "relation_name": active_relation_name,
        "user_message": user_text,
        "assistant_reply": assistant_text,
        "attachment_names": _attachment_names(user_payload),
        "rule_score": assistant_payload.get("rule_score"),
        "hit_rules": _normalize_tags(assistant_payload.get("hit_rules"), limit=6),
        "fraud_type_hints": _normalize_tags(assistant_payload.get("fraud_type_hints"), limit=6),
        "stage_tags": _normalize_tags(assistant_payload.get("stage_tags"), limit=6),
        "references": reference_lines,
    }


def _fallback_detection_event_risk_score(result: DetectionResult) -> int:
    final_score = _extract_final_score(result)
    if final_score is not None:
        return final_score
    level = str(result.risk_level or "").lower()
    if level == "high":
        return 82
    if level == "medium":
        return 58
    if result.need_manual_review:
        return 36
    return 16


def _fallback_detection_urgency_delta(result: DetectionResult) -> int:
    score = _fallback_detection_event_risk_score(result)
    delta = max(4, round(score * 0.36))
    if str(result.risk_level or "").lower() == "high":
        delta += 6
    elif str(result.risk_level or "").lower() == "medium":
        delta += 3
    if result.need_manual_review:
        delta += 2
    if result.fraud_type and str(result.fraud_type).strip() not in {"", "未知", "待人工复核"}:
        delta += 2
    return max(0, min(40, delta))


def _fallback_detection_safety_score(user: User, result: DetectionResult) -> int:
    current = user.safety_score if isinstance(user.safety_score, int) else settings.user_profile_default_safety_score
    event_risk = _fallback_detection_event_risk_score(result)
    event_safety = max(10, min(99, 100 - event_risk))
    if str(result.risk_level or "").lower() == "low" and not result.need_manual_review:
        event_safety = max(event_safety, 92)
    return max(0, min(100, round(current * 0.6 + event_safety * 0.4)))


def _fallback_assistant_event_risk_score(event: dict[str, Any]) -> int:
    base = _clamp_int(event.get("rule_score"), minimum=0, maximum=100, fallback=0)
    hit_rules = event.get("hit_rules") or []
    fraud_hints = event.get("fraud_type_hints") or []
    stage_tags = event.get("stage_tags") or []
    user_text = _clean_text(event.get("user_message"), max_length=220)
    keyword_hits = sum(1 for item in _RISK_KEYWORDS if item in user_text)
    score = base + len(hit_rules) * 6 + len(fraud_hints) * 5 + len(stage_tags) * 3 + keyword_hits * 5
    if score <= 0 and user_text:
        score = 12
    return max(0, min(90, score))


def _fallback_assistant_urgency_delta(event: dict[str, Any]) -> int:
    risk_score = _fallback_assistant_event_risk_score(event)
    delta = max(2, round(risk_score * 0.26))
    if event.get("relation_name"):
        delta += 2
    if event.get("hit_rules"):
        delta += 2
    return max(0, min(40, delta))


def _fallback_assistant_safety_score(user: User, event: dict[str, Any]) -> int:
    current = user.safety_score if isinstance(user.safety_score, int) else settings.user_profile_default_safety_score
    event_risk = _fallback_assistant_event_risk_score(event)
    user_text = _clean_text(event.get("user_message"), max_length=220)
    event_safety = max(18, min(98, 100 - event_risk))
    if any(token in user_text for token in ("帮我判断", "帮我看看", "先问你", "核验", "确认一下")):
        event_safety = max(event_safety, 86)
    return max(0, min(100, round(current * 0.72 + event_safety * 0.28)))


def _fallback_detection_candidate_memory(event: dict[str, Any]) -> str:
    fraud_type = _clean_text(event.get("fraud_type"), max_length=24)
    summary = _clean_text(event.get("summary"), max_length=90)
    if fraud_type and fraud_type not in {"未知", "待人工复核"} and summary:
        return _clean_text(
            f"近期多次暴露于{fraud_type}相关风险场景，需对同类话术保持高敏感。",
            max_length=settings.user_profile_summary_max_length,
        )
    if summary:
        return summary
    return _clean_text(event.get("final_reason"), max_length=100)


def _fallback_assistant_candidate_memory(event: dict[str, Any]) -> str:
    relation_name = _clean_text(event.get("relation_name"), max_length=16)
    fraud_hints = event.get("fraud_type_hints") or []
    hit_rules = event.get("hit_rules") or []
    user_text = _clean_text(event.get("user_message"), max_length=140)
    if relation_name and any(word in user_text for word in ("转账", "验证码", "链接", "借钱")):
        return _clean_text(
            f"用户常为{relation_name}相关转账或消息先来助手核验，关键决策依赖二次确认。",
            max_length=settings.user_profile_summary_max_length,
        )
    if fraud_hints:
        return _clean_text(
            f"用户对{fraud_hints[0]}等风险场景会主动求证，可将“先核验再操作”作为防护习惯强化。",
            max_length=settings.user_profile_summary_max_length,
        )
    if hit_rules:
        return _clean_text(
            f"用户在对话中反复遇到{hit_rules[0]}相关风险线索，需要持续提醒同类陷阱。",
            max_length=settings.user_profile_summary_max_length,
        )
    if any(token in user_text for token in ("帮我判断", "帮我看看", "确认一下", "靠谱吗")):
        return _clean_text(
            "用户在不确定场景下愿意主动求证，这是一种可持续强化的自我保护习惯。",
            max_length=settings.user_profile_summary_max_length,
        )
    return ""


def _fallback_query_tags(event: dict[str, Any]) -> list[str]:
    source = _clean_text(event.get("source"), max_length=12)
    values: list[Any] = []
    for key in (
        "fraud_type",
        "risk_level",
        "relation_name",
        "hit_rules",
        "fraud_type_hints",
        "stage_tags",
        "attachment_names",
    ):
        raw = event.get(key)
        if isinstance(raw, list):
            values.extend(raw)
        else:
            values.append(raw)

    user_text = _clean_text(event.get("user_message"), max_length=220)
    for token in _RISK_KEYWORDS:
        if token in user_text:
            values.append(token)
    tags = _normalize_tags(values, limit=6)
    if not tags and source:
        tags = [source]
    return tags


def _fallback_memory_bucket(event: dict[str, Any]) -> str:
    source = _clean_text(event.get("source"), max_length=16)
    if source == "detection":
        return "risk_pattern"
    user_text = _clean_text(event.get("user_message"), max_length=220)
    if event.get("relation_name"):
        return "relationship"
    if any(token in user_text for token in ("帮我判断", "帮我看看", "确认一下", "先问你")):
        return "protection"
    if event.get("fraud_type_hints") or event.get("hit_rules"):
        return "risk_pattern"
    return "communication_style"


def _run_json_prompt(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    client = build_chat_json_client()
    return client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt).payload


def _collect_recent_memory_candidates(
    db: Session,
    *,
    user_id: uuid.UUID,
    exclude_event_key: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    target_limit = limit or max(
        settings.user_profile_recent_result_limit + settings.user_memory_recent_assistant_limit,
        12,
    )
    items: list[dict[str, Any]] = []

    detection_rows = detection_repository.list_recent_results_for_user(
        db,
        user_id=user_id,
        limit=max(target_limit, settings.user_profile_recent_result_limit + 6),
    )
    for result, _submission in detection_rows:
        snapshot = _extract_detection_profile_memory_snapshot(result)
        candidate_memory = _clean_text(snapshot.get("candidate_memory"), max_length=120)
        event_key = f"detection:{result.id}"
        if exclude_event_key == event_key or not candidate_memory:
            continue
        items.append(
            {
                "event_key": event_key,
                "source": "detection",
                "event_id": str(result.id),
                "created_at": snapshot.get("created_at") or (result.created_at.isoformat() if result.created_at else None),
                "candidate_memory": candidate_memory,
                "memory_bucket": _clean_text(snapshot.get("memory_bucket"), max_length=24),
                "query_tags": _normalize_tags(snapshot.get("query_tags"), limit=6),
                "relation_name": _clean_text(snapshot.get("relation_name"), max_length=24),
                "promoted": _safe_bool(snapshot.get("promoted"), False) or _safe_bool(snapshot.get("promoted_now"), False),
                "promotion_score": _clamp_float(snapshot.get("promotion_score"), minimum=0.0, maximum=1.0, fallback=0.0),
            }
        )

    assistant_messages = assistant_repository.list_recent_messages_for_user(
        db,
        user_id=user_id,
        role="assistant",
        limit=max(target_limit, settings.user_memory_recent_assistant_limit),
    )
    for message in assistant_messages:
        snapshot = _extract_assistant_profile_memory_snapshot(message)
        candidate_memory = _clean_text(snapshot.get("candidate_memory"), max_length=120)
        event_key = f"assistant:{message.id}"
        if exclude_event_key == event_key or not candidate_memory:
            continue
        items.append(
            {
                "event_key": event_key,
                "source": "assistant",
                "event_id": str(message.id),
                "created_at": snapshot.get("created_at") or (message.created_at.isoformat() if message.created_at else None),
                "candidate_memory": candidate_memory,
                "memory_bucket": _clean_text(snapshot.get("memory_bucket"), max_length=24),
                "query_tags": _normalize_tags(snapshot.get("query_tags"), limit=6),
                "relation_name": _clean_text(snapshot.get("relation_name"), max_length=24),
                "promoted": _safe_bool(snapshot.get("promoted"), False) or _safe_bool(snapshot.get("promoted_now"), False),
                "promotion_score": _clamp_float(snapshot.get("promotion_score"), minimum=0.0, maximum=1.0, fallback=0.0),
            }
        )

    items.sort(key=lambda item: _event_timestamp(item.get("created_at")), reverse=True)
    return items[:target_limit]


def _unique_candidate_texts(candidates: list[dict[str, Any]], *, limit: int) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        text = _clean_text(candidate.get("candidate_memory"), max_length=120)
        if not text or text in seen:
            continue
        seen.add(text)
        items.append(text)
        if len(items) >= limit:
            break
    return items


def _query_signature(item: dict[str, Any]) -> str:
    tags = tuple(sorted(_normalize_tags(item.get("query_tags"), limit=6)))
    if tags:
        return "|".join(tags)
    relation_name = _clean_text(item.get("relation_name"), max_length=24)
    if relation_name:
        return relation_name
    return _clean_text(item.get("source"), max_length=16, fallback="memory")


def _candidate_matches(current_event: dict[str, Any], prior: dict[str, Any]) -> bool:
    current_text = _clean_text(current_event.get("candidate_memory"), max_length=120)
    prior_text = _clean_text(prior.get("candidate_memory"), max_length=120)
    if current_text and prior_text and (current_text in prior_text or prior_text in current_text):
        return True

    current_tags = set(_normalize_tags(current_event.get("query_tags"), limit=6))
    prior_tags = set(_normalize_tags(prior.get("query_tags"), limit=6))
    if current_tags and prior_tags and current_tags.intersection(prior_tags):
        return True

    current_bucket = _clean_text(current_event.get("memory_bucket"), max_length=24)
    prior_bucket = _clean_text(prior.get("memory_bucket"), max_length=24)
    relation_name = _clean_text(current_event.get("relation_name"), max_length=24)
    prior_relation_name = _clean_text(prior.get("relation_name"), max_length=24)
    if current_bucket and prior_bucket and current_bucket == prior_bucket and relation_name and relation_name == prior_relation_name:
        return True
    return False


def _conceptual_richness(event: dict[str, Any]) -> float:
    tags = _normalize_tags(event.get("query_tags"), limit=6)
    evidence_items = []
    for key in ("risk_evidence", "counter_evidence", "references", "attachment_names"):
        raw = event.get(key)
        if isinstance(raw, list):
            evidence_items.extend(raw)
    richness = (len(tags) * 0.55) + (min(len(evidence_items), 4) * 0.3)
    if event.get("relation_name"):
        richness += 0.4
    if _clean_text(event.get("candidate_memory"), max_length=160):
        richness += 0.3
    return max(0.0, min(1.0, richness / 4.0))


def _promotion_signals(current_event: dict[str, Any], prior_candidates: list[dict[str, Any]]) -> dict[str, Any]:
    now = _event_timestamp(current_event.get("created_at"))
    valid_prior: list[dict[str, Any]] = []
    for item in prior_candidates:
        created_at = _parse_datetime(item.get("created_at"))
        if created_at is None:
            continue
        age_days = max(0.0, (now - created_at).total_seconds() / 86400.0)
        if age_days > settings.user_memory_max_age_days:
            continue
        valid_prior.append(item)

    matches = [item for item in valid_prior if _candidate_matches(current_event, item)]
    recall_count = len(matches) + 1
    signatures = {_query_signature(item) for item in matches}
    signatures.add(_query_signature(current_event))
    unique_query_count = max(1, len({item for item in signatures if item}))
    distinct_days = {_event_timestamp(item.get("created_at")).date().isoformat() for item in matches}
    distinct_days.add(now.date().isoformat())
    source_diversity = {str(item.get("source") or "").strip() for item in matches if str(item.get("source") or "").strip()}
    source_diversity.add(_clean_text(current_event.get("source"), max_length=16, fallback="memory"))

    frequency = min(1.0, recall_count / 3.0)
    diversity = min(1.0, max(unique_query_count, len(source_diversity)) / 3.0)

    recency_support = 0.0
    for item in matches:
        created_at = _event_timestamp(item.get("created_at"))
        age_days = max(0.0, (now - created_at).total_seconds() / 86400.0)
        recency_support = max(
            recency_support,
            math.exp(-math.log(2) * age_days / max(1, settings.user_memory_recency_half_life_days)),
        )
    recency = 0.35 + 0.65 * recency_support if matches else 0.35

    consolidation = min(1.0, len(distinct_days) / 3.0)
    relevance = _clamp_float(current_event.get("salience_score"), minimum=0.0, maximum=1.0, fallback=0.5)
    richness = _conceptual_richness(current_event)

    score = (
        frequency * 0.24
        + relevance * 0.30
        + diversity * 0.15
        + recency * 0.15
        + consolidation * 0.10
        + richness * 0.06
    )
    return {
        "frequency": round(frequency, 4),
        "relevance": round(relevance, 4),
        "diversity": round(diversity, 4),
        "recency": round(recency, 4),
        "consolidation": round(consolidation, 4),
        "richness": round(richness, 4),
        "score": round(score, 4),
        "matching_count": len(matches),
        "recall_count": recall_count,
        "unique_query_count": unique_query_count,
        "distinct_days": len(distinct_days),
    }


def _fallback_merge_profile(existing_profile_summary: str | None, candidate_memory: str) -> str:
    existing = _clean_text(existing_profile_summary, max_length=settings.user_profile_summary_max_length)
    candidate = _clean_text(candidate_memory, max_length=settings.user_profile_summary_max_length)
    if not existing:
        return candidate
    if not candidate or candidate in existing:
        return existing
    merged = f"{existing}；{candidate}"
    return _clean_text(merged, max_length=settings.user_profile_summary_max_length, fallback=existing)


def _merge_profile_summary(
    *,
    user_context: dict[str, Any],
    existing_profile_summary: str | None,
    recent_candidates: list[dict[str, Any]],
    candidate_memory: str,
) -> tuple[str, str]:
    prior_candidate_memories = _unique_candidate_texts(
        recent_candidates,
        limit=settings.user_profile_recent_result_limit,
    )
    try:
        system_prompt, user_prompt = build_profile_merge_prompts(
            user_context=user_context,
            existing_profile_summary=existing_profile_summary,
            prior_candidate_memories=prior_candidate_memories,
            candidate_memory=candidate_memory,
            recent_candidates=recent_candidates,
        )
        payload = _run_json_prompt(system_prompt, user_prompt)
        merged_summary = _clean_text(
            payload.get("profile_summary"),
            max_length=settings.user_profile_summary_max_length,
            fallback=_fallback_merge_profile(existing_profile_summary, candidate_memory),
        )
        merge_reason = _clean_text(payload.get("merge_reason"), max_length=120)
        return merged_summary, merge_reason
    except Exception:  # noqa: BLE001
        logger.exception("User profile merge failed")
        return _fallback_merge_profile(existing_profile_summary, candidate_memory), ""


def _evaluate_event_for_memory(
    *,
    user: User,
    current_event: dict[str, Any],
    recent_candidates: list[dict[str, Any]],
    assessment_builder: Any,
    fallback_candidate_builder: Any,
    fallback_safety_score: int,
    fallback_urgency_delta: int,
) -> tuple[dict[str, Any], str | None]:
    user_context = _build_user_context_payload(user, memory_path=get_user_memory_path(user.id))
    urgency_before = max(0, min(100, int(user.memory_urgency_score or 0)))

    should_promote = False
    urgency_delta = fallback_urgency_delta
    safety_score = fallback_safety_score
    candidate_memory = ""
    event_title = _clean_text(current_event.get("title"), max_length=24)
    memory_bucket = _fallback_memory_bucket(current_event)
    query_tags = _fallback_query_tags(current_event)
    promotion_reason = ""
    salience_score = round(max(0.2, min(0.95, fallback_urgency_delta / 40.0)), 4)

    try:
        system_prompt, user_prompt = assessment_builder(
            user_context=user_context,
            existing_profile_summary=user.profile_summary,
            current_event=current_event,
            recent_candidates=recent_candidates,
        )
        payload = _run_json_prompt(system_prompt, user_prompt)
        should_promote = _safe_bool(payload.get("should_promote"))
        urgency_delta = _clamp_int(payload.get("urgency_delta"), minimum=0, maximum=40, fallback=fallback_urgency_delta)
        safety_score = _clamp_int(payload.get("safety_score"), minimum=0, maximum=100, fallback=fallback_safety_score)
        candidate_memory = _clean_text(payload.get("candidate_memory"), max_length=settings.user_profile_summary_max_length)
        event_title = _clean_text(payload.get("event_title"), max_length=24, fallback=event_title)
        memory_bucket_candidate = _clean_text(payload.get("memory_bucket"), max_length=32)
        if memory_bucket_candidate in _MEMORY_BUCKET_LABELS:
            memory_bucket = memory_bucket_candidate
        query_tags = _normalize_tags(payload.get("query_tags"), limit=6) or query_tags
        promotion_reason = _clean_text(payload.get("promotion_reason"), max_length=120)
        salience_score = _clamp_float(payload.get("salience_score"), minimum=0.0, maximum=1.0, fallback=salience_score)
    except Exception:  # noqa: BLE001
        logger.exception("User profile assessment failed for user=%s event=%s", user.id, current_event.get("event_id"))

    current_event = {
        **current_event,
        "event_title": event_title,
        "candidate_memory": candidate_memory,
        "memory_bucket": memory_bucket,
        "query_tags": query_tags,
        "salience_score": salience_score,
    }
    if not current_event["candidate_memory"] and should_promote:
        current_event["candidate_memory"] = _clean_text(
            fallback_candidate_builder(current_event),
            max_length=settings.user_profile_summary_max_length,
        )
    if not current_event["query_tags"]:
        current_event["query_tags"] = _fallback_query_tags(current_event)

    signals = _promotion_signals(current_event, recent_candidates)
    next_urgency = max(0, min(100, urgency_before + urgency_delta))
    threshold_hit = next_urgency >= settings.user_profile_memory_urgency_threshold
    score_hit = (
        signals["score"] >= settings.user_memory_promotion_score_threshold
        and signals["recall_count"] >= settings.user_memory_promotion_min_recall_count
        and signals["unique_query_count"] >= settings.user_memory_promotion_min_unique_queries
    )
    promote_now = should_promote or score_hit or threshold_hit

    if promote_now and not current_event["candidate_memory"]:
        current_event["candidate_memory"] = _clean_text(
            fallback_candidate_builder(current_event),
            max_length=settings.user_profile_summary_max_length,
        )

    merged_summary = user.profile_summary
    merge_reason = ""
    if promote_now and current_event["candidate_memory"]:
        merged_summary, merge_reason = _merge_profile_summary(
            user_context=user_context,
            existing_profile_summary=user.profile_summary,
            recent_candidates=recent_candidates,
            candidate_memory=current_event["candidate_memory"],
        )
        user.profile_summary = merged_summary
        user.memory_urgency_score = (
            max(0, next_urgency - settings.user_profile_memory_urgency_threshold)
            if threshold_hit
            else next_urgency
        )
    else:
        user.memory_urgency_score = next_urgency

    user.safety_score = safety_score
    snapshot = {
        "source": current_event.get("source"),
        "event_id": current_event.get("event_id"),
        "event_title": event_title,
        "created_at": current_event.get("created_at"),
        "relation_name": _clean_text(current_event.get("relation_name"), max_length=24),
        "candidate_memory": current_event["candidate_memory"],
        "memory_bucket": current_event["memory_bucket"],
        "query_tags": current_event["query_tags"],
        "should_promote": should_promote,
        "score_hit": score_hit,
        "promoted_now": promote_now,
        "promoted": promote_now,
        "threshold_hit": threshold_hit,
        "urgency_delta": urgency_delta,
        "urgency_score_before": urgency_before,
        "urgency_score_after": user.memory_urgency_score,
        "safety_score": safety_score,
        "promotion_reason": promotion_reason,
        "merge_reason": merge_reason,
        "merged_profile_summary": merged_summary,
        "promotion_score": signals["score"],
        "promotion_signals": signals,
        "salience_score": salience_score,
    }
    return snapshot, merged_summary


def _daily_note_header(user: User, *, day: date) -> str:
    return "\n".join(
        [
            f"# {day.isoformat()}",
            "",
            "> 用户日记记忆。这里保留当天事件、候选记忆与晋升轨迹；长期稳定内容会沉淀到 `MEMORY.md`。",
            "",
            f"- 用户：{user.display_name}",
            f"- 用户ID：{user.id}",
            f"- 角色：{_USER_ROLE_LABELS.get(user.role, user.role)}",
        ]
    ).rstrip()


def _daily_note_block(*, event: dict[str, Any], snapshot: dict[str, Any]) -> str:
    created_at = _event_timestamp(event.get("created_at")).isoformat()
    source = _clean_text(event.get("source"), max_length=16, fallback="memory")
    status = "promoted" if snapshot.get("promoted_now") else "watch"
    marker = f"<!-- event:{source}:{event.get('event_id')} -->"
    lines = [
        marker,
        f"## {created_at} ｜ {source} ｜ {status}",
        f"- 标题：{_clean_text(snapshot.get('event_title'), max_length=32, fallback='画像观察')}",
        f"- 候选记忆：{_clean_text(snapshot.get('candidate_memory'), max_length=140, fallback='暂无')}",
        f"- 记忆分桶：{_MEMORY_BUCKET_LABELS.get(str(snapshot.get('memory_bucket') or ''), str(snapshot.get('memory_bucket') or '未分类'))}",
        f"- 紧迫值：{snapshot.get('urgency_score_before', 0)} -> {snapshot.get('urgency_score_after', 0)}（+{snapshot.get('urgency_delta', 0)}）",
        f"- 晋升分：{snapshot.get('promotion_score', 0)}",
        f"- 标签：{' / '.join(snapshot.get('query_tags') or []) or '暂无'}",
    ]
    relation_name = _clean_text(snapshot.get("relation_name"), max_length=24)
    if relation_name:
        lines.append(f"- 关系对象：{relation_name}")
    summary_parts = [
        _clean_text(event.get("summary"), max_length=140),
        _clean_text(event.get("user_message"), max_length=140),
        _clean_text(event.get("assistant_reply"), max_length=140),
    ]
    summary_parts = [item for item in summary_parts if item]
    if summary_parts:
        lines.append(f"- 事件摘要：{' ｜ '.join(summary_parts[:2])}")
    evidence_parts = []
    for key in ("risk_evidence", "references", "hit_rules", "fraud_type_hints"):
        raw = event.get(key)
        if isinstance(raw, list):
            evidence_parts.extend(_normalize_tags(raw, limit=4))
    if evidence_parts:
        lines.append(f"- 证据线索：{' / '.join(evidence_parts[:6])}")
    reason = _clean_text(snapshot.get("promotion_reason"), max_length=120)
    if reason:
        lines.append(f"- 晋升判断：{reason}")
    return "\n".join(lines)


def _append_daily_note(user: User, *, event: dict[str, Any], snapshot: dict[str, Any]) -> Path:
    created_at = _event_timestamp(event.get("created_at"))
    path = get_user_daily_note_path(user.id, created_at.date())
    existing = _read_utf8_text(path)
    marker = f"<!-- event:{event.get('source')}:{event.get('event_id')} -->"
    if existing and marker in existing:
        return path
    if not existing:
        existing = _daily_note_header(user, day=created_at.date())
    block = _daily_note_block(event=event, snapshot=snapshot)
    merged = existing.rstrip() + "\n\n" + block.rstrip() + "\n"
    _write_utf8_text(path, merged)
    return path


def _entry_from_detection(result: DetectionResult) -> dict[str, Any] | None:
    snapshot = _extract_detection_profile_memory_snapshot(result)
    if not (_safe_bool(snapshot.get("promoted"), False) or _safe_bool(snapshot.get("promoted_now"), False)):
        return None
    candidate_memory = _clean_text(snapshot.get("candidate_memory"), max_length=140)
    if not candidate_memory:
        return None
    return {
        "source": "detection",
        "event_id": str(result.id),
        "created_at": snapshot.get("created_at") or (result.created_at.isoformat() if result.created_at else None),
        "event_title": _clean_text(snapshot.get("event_title"), max_length=30, fallback="检测画像观察"),
        "candidate_memory": candidate_memory,
        "memory_bucket": _clean_text(snapshot.get("memory_bucket"), max_length=24, fallback="risk_pattern"),
        "query_tags": _normalize_tags(snapshot.get("query_tags"), limit=6),
        "relation_name": _clean_text(snapshot.get("relation_name"), max_length=24),
        "promotion_reason": _clean_text(snapshot.get("promotion_reason"), max_length=120),
        "promotion_score": _clamp_float(snapshot.get("promotion_score"), minimum=0.0, maximum=1.0, fallback=0.0),
        "promotion_signals": snapshot.get("promotion_signals") if isinstance(snapshot.get("promotion_signals"), dict) else {},
    }


def _entry_from_assistant(message: AssistantMessage) -> dict[str, Any] | None:
    snapshot = _extract_assistant_profile_memory_snapshot(message)
    if not (_safe_bool(snapshot.get("promoted"), False) or _safe_bool(snapshot.get("promoted_now"), False)):
        return None
    candidate_memory = _clean_text(snapshot.get("candidate_memory"), max_length=140)
    if not candidate_memory:
        return None
    return {
        "source": "assistant",
        "event_id": str(message.id),
        "created_at": snapshot.get("created_at") or (message.created_at.isoformat() if message.created_at else None),
        "event_title": _clean_text(snapshot.get("event_title"), max_length=30, fallback="助手对话画像观察"),
        "candidate_memory": candidate_memory,
        "memory_bucket": _clean_text(snapshot.get("memory_bucket"), max_length=24, fallback="communication_style"),
        "query_tags": _normalize_tags(snapshot.get("query_tags"), limit=6),
        "relation_name": _clean_text(snapshot.get("relation_name"), max_length=24),
        "promotion_reason": _clean_text(snapshot.get("promotion_reason"), max_length=120),
        "promotion_score": _clamp_float(snapshot.get("promotion_score"), minimum=0.0, maximum=1.0, fallback=0.0),
        "promotion_signals": snapshot.get("promotion_signals") if isinstance(snapshot.get("promotion_signals"), dict) else {},
    }


def _dedupe_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entry in sorted(
        entries,
        key=lambda item: (
            _event_timestamp(item.get("created_at")),
            _clamp_float(item.get("promotion_score"), minimum=0.0, maximum=1.0, fallback=0.0),
        ),
        reverse=True,
    ):
        key = (
            _clean_text(entry.get("memory_bucket"), max_length=24),
            _clean_text(entry.get("candidate_memory"), max_length=140),
        )
        if not key[1] or key in seen:
            continue
        seen.add(key)
        items.append(entry)
        if len(items) >= settings.user_memory_long_term_entry_limit:
            break
    return items


def _collect_promoted_entries(db: Session, *, user_id: uuid.UUID) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    detection_rows = detection_repository.list_recent_results_for_user(
        db,
        user_id=user_id,
        limit=settings.user_memory_long_term_entry_limit * 2,
    )
    for result, _submission in detection_rows:
        entry = _entry_from_detection(result)
        if entry:
            entries.append(entry)

    assistant_messages = assistant_repository.list_recent_messages_for_user(
        db,
        user_id=user_id,
        role="assistant",
        limit=settings.user_memory_long_term_entry_limit * 2,
    )
    for message in assistant_messages:
        entry = _entry_from_assistant(message)
        if entry:
            entries.append(entry)
    return _dedupe_entries(entries)


def _section_lines(entries: list[dict[str, Any]], *, buckets: set[str], limit: int) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        bucket = _clean_text(entry.get("memory_bucket"), max_length=24)
        text = _clean_text(entry.get("candidate_memory"), max_length=140)
        if bucket not in buckets or not text or text in seen:
            continue
        seen.add(text)
        lines.append(text)
        if len(lines) >= limit:
            break
    return lines


def _render_entry(entry: dict[str, Any]) -> str:
    created_at = _event_timestamp(entry.get("created_at")).date().isoformat()
    source = _clean_text(entry.get("source"), max_length=16, fallback="memory")
    bucket = _MEMORY_BUCKET_LABELS.get(
        _clean_text(entry.get("memory_bucket"), max_length=24),
        _clean_text(entry.get("memory_bucket"), max_length=24, fallback="未分类"),
    )
    lines = [
        f"### {created_at} ｜ {source} ｜ {bucket}",
        f"- 标题：{_clean_text(entry.get('event_title'), max_length=32, fallback='画像观察')}",
        f"- 内容：{_clean_text(entry.get('candidate_memory'), max_length=180, fallback='暂无')}",
    ]
    tags = entry.get("query_tags") or []
    if tags:
        lines.append(f"- 标签：{' / '.join(tags)}")
    relation_name = _clean_text(entry.get("relation_name"), max_length=24)
    if relation_name:
        lines.append(f"- 关系对象：{relation_name}")
    lines.append(f"- 晋升分：{entry.get('promotion_score', 0)}")
    signals = entry.get("promotion_signals") if isinstance(entry.get("promotion_signals"), dict) else {}
    if signals:
        signal_text = " / ".join(
            [
                f"频率 {signals.get('frequency', 0)}",
                f"相关 {signals.get('relevance', 0)}",
                f"多样 {signals.get('diversity', 0)}",
                f"近因 {signals.get('recency', 0)}",
                f"巩固 {signals.get('consolidation', 0)}",
                f"丰富 {signals.get('richness', 0)}",
            ]
        )
        lines.append(f"- 信号：{signal_text}")
    reason = _clean_text(entry.get("promotion_reason"), max_length=120)
    if reason:
        lines.append(f"- 原因：{reason}")
    return "\n".join(lines)


def _render_memory_markdown(user: User, *, entries: list[dict[str, Any]], memory_path: Path) -> str:
    summary = _clean_text(user.profile_summary, max_length=settings.user_profile_summary_max_length, fallback="暂无稳定长期画像。")
    risk_lines = _section_lines(entries, buckets={"risk_pattern"}, limit=5)
    behavior_lines = _section_lines(entries, buckets={"communication_style", "preference"}, limit=5)
    guard_lines = _section_lines(entries, buckets={"protection", "stability_signal"}, limit=5)
    relation_lines = _section_lines(entries, buckets={"relationship"}, limit=5)

    blocks: list[str] = [
        "# 用户 MEMORY",
        "",
        "> 这是用户的长期画像记忆。只保留跨会话稳定、可复用、会影响后续提醒与干预策略的信息；当日原始材料保存在 `memory/YYYY-MM-DD.md`。",
        "",
        "## 用户卡片",
        f"- 用户ID：{user.id}",
        f"- 文件路径：{_display_path(memory_path)}",
        f"- 称呼：{user.display_name}",
        f"- 角色：{_USER_ROLE_LABELS.get(user.role, user.role)}",
        f"- 监护关系：{_clean_text(user.guardian_relation, max_length=24, fallback='暂无')}",
        f"- 当前安全分：{user.safety_score}",
        f"- 当前记忆紧急度：{user.memory_urgency_score}",
        f"- 最近更新：{_utcnow().isoformat()}",
        "",
        "## 长期画像摘要",
        summary,
        "",
        "## 主要风险模式",
        *([f"- {item}" for item in risk_lines] or ["- 暂无"]),
        "",
        "## 沟通与行为特征",
        *([f"- {item}" for item in behavior_lines] or ["- 暂无"]),
        "",
        "## 防护重点",
        *([f"- {item}" for item in guard_lines] or ["- 暂无"]),
        "",
        "## 关系与场景线索",
        *([f"- {item}" for item in relation_lines] or ["- 暂无"]),
        "",
        "## 长期记忆条目",
    ]
    if entries:
        for entry in entries[: settings.user_memory_long_term_entry_limit]:
            blocks.extend(["", _render_entry(entry)])
    else:
        blocks.extend(["", "- 暂无"])
    return "\n".join(blocks).rstrip() + "\n"


def _sync_user_memory_markdown(db: Session, *, user: User) -> Path:
    memory_path = get_user_memory_path(user.id)
    entries = _collect_promoted_entries(db, user_id=user.id)
    markdown = _render_memory_markdown(user, entries=entries, memory_path=memory_path)
    _write_utf8_text(memory_path, markdown)
    return memory_path


def build_user_memory_prompt_context(db: Session, *, user_id: uuid.UUID) -> str | None:
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        return None
    memory_path = get_user_memory_path(user.id)
    if not memory_path.exists():
        _sync_user_memory_markdown(db, user=user)
    entries = _collect_promoted_entries(db, user_id=user.id)
    lines = [
        f"称呼：{user.display_name}",
        f"年龄层：{_USER_ROLE_LABELS.get(user.role, user.role)}",
        f"长期记忆文件：{_display_path(memory_path)}",
    ]
    if user.birth_date is not None:
        lines.append(f"出生日期：{user.birth_date.isoformat()}")
    guardian_relation = _clean_text(user.guardian_relation, max_length=24)
    if guardian_relation:
        lines.append(f"监护关系：{guardian_relation}")
    profile_summary = _clean_text(user.profile_summary, max_length=settings.user_profile_summary_max_length)
    if profile_summary:
        lines.append(f"画像摘要：{profile_summary}")

    risk_lines = _section_lines(entries, buckets={"risk_pattern"}, limit=3)
    behavior_lines = _section_lines(entries, buckets={"communication_style", "preference"}, limit=3)
    guard_lines = _section_lines(entries, buckets={"protection", "stability_signal"}, limit=3)
    relation_lines = _section_lines(entries, buckets={"relationship"}, limit=3)
    recent_entries = entries[: settings.user_memory_prompt_entry_limit]

    blocks = ["用户画像：\n- " + "\n- ".join(lines)]
    if risk_lines:
        blocks.append("长期风险模式：\n- " + "\n- ".join(risk_lines))
    if behavior_lines:
        blocks.append("沟通与行为特征：\n- " + "\n- ".join(behavior_lines))
    if guard_lines:
        blocks.append("防护重点：\n- " + "\n- ".join(guard_lines))
    if relation_lines:
        blocks.append("关系与场景线索：\n- " + "\n- ".join(relation_lines))
    if recent_entries:
        recent_lines = [
            f"[{_event_timestamp(item.get('created_at')).date().isoformat()} / {item.get('source')}] {item.get('candidate_memory')}"
            for item in recent_entries
        ]
        blocks.append("近期已晋升记忆：\n- " + "\n- ".join(recent_lines))
    return "\n\n".join(blocks)


def refresh_user_profile_from_detection(
    db: Session,
    *,
    user_id: uuid.UUID,
    submission: DetectionSubmission,
    result: DetectionResult,
) -> None:
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        return

    current_event = _build_detection_event_payload(
        db,
        user_id=user_id,
        submission=submission,
        result=result,
    )
    recent_candidates = _collect_recent_memory_candidates(
        db,
        user_id=user_id,
        exclude_event_key=f"detection:{result.id}",
    )
    snapshot, _merged_summary = _evaluate_event_for_memory(
        user=user,
        current_event=current_event,
        recent_candidates=recent_candidates,
        assessment_builder=build_detection_memory_assessment_prompts,
        fallback_candidate_builder=_fallback_detection_candidate_memory,
        fallback_safety_score=_fallback_detection_safety_score(user, result),
        fallback_urgency_delta=_fallback_detection_urgency_delta(result),
    )

    daily_note_path = _append_daily_note(user, event=current_event, snapshot=snapshot)
    memory_path = get_user_memory_path(user.id)
    snapshot["memory_path"] = _display_path(memory_path)
    snapshot["daily_note_path"] = _display_path(daily_note_path)

    existing_detail = result.result_detail if isinstance(result.result_detail, dict) else {}
    detail = dict(existing_detail)
    detail["profile_memory"] = snapshot
    result.result_detail = detail
    db.add(result)
    user_repository.save(db, user)
    _sync_user_memory_markdown(db, user=user)


def refresh_user_profile_from_assistant_turn(
    db: Session,
    *,
    user_id: uuid.UUID,
    session: AssistantSession,
    user_message: AssistantMessage,
    assistant_message: AssistantMessage,
    relation_profile_id: uuid.UUID | None = None,
) -> None:
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        return

    relation_name = _relation_name(
        db,
        user_id=user_id,
        relation_profile_id=relation_profile_id or session.relation_profile_id,
    )
    current_event = _build_assistant_event_payload(
        session=session,
        user_message=user_message,
        assistant_message=assistant_message,
        relation_name=relation_name,
    )
    recent_candidates = _collect_recent_memory_candidates(
        db,
        user_id=user_id,
        exclude_event_key=f"assistant:{assistant_message.id}",
    )
    snapshot, _merged_summary = _evaluate_event_for_memory(
        user=user,
        current_event=current_event,
        recent_candidates=recent_candidates,
        assessment_builder=build_assistant_memory_assessment_prompts,
        fallback_candidate_builder=_fallback_assistant_candidate_memory,
        fallback_safety_score=_fallback_assistant_safety_score(user, current_event),
        fallback_urgency_delta=_fallback_assistant_urgency_delta(current_event),
    )

    daily_note_path = _append_daily_note(user, event=current_event, snapshot=snapshot)
    memory_path = get_user_memory_path(user.id)
    snapshot["memory_path"] = _display_path(memory_path)
    snapshot["daily_note_path"] = _display_path(daily_note_path)

    payload = assistant_message.extra_payload if isinstance(assistant_message.extra_payload, dict) else {}
    assistant_message.extra_payload = {
        **payload,
        "profile_memory": snapshot,
    }
    assistant_repository.save_message(db, assistant_message)
    user_repository.save(db, user)
    _sync_user_memory_markdown(db, user=user)


def list_user_memory_history(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int = 20,
) -> list[dict[str, Any]]:
    normalized_limit = max(1, min(limit, 100))
    items: list[dict[str, Any]] = []

    detection_rows = detection_repository.list_recent_results_for_user(
        db,
        user_id=user_id,
        limit=max(normalized_limit * 2, 16),
    )
    for result, _submission in detection_rows:
        snapshot = _extract_detection_profile_memory_snapshot(result)
        if not snapshot:
            continue
        items.append(
            {
                "id": result.id,
                "source": "detection",
                "created_at": result.created_at,
                "risk_level": result.risk_level,
                "fraud_type": result.fraud_type,
                "summary": result.summary,
                "snapshot": snapshot,
            }
        )

    assistant_messages = assistant_repository.list_recent_messages_for_user(
        db,
        user_id=user_id,
        role="assistant",
        limit=max(normalized_limit * 2, 16),
    )
    for message in assistant_messages:
        snapshot = _extract_assistant_profile_memory_snapshot(message)
        if not snapshot:
            continue
        items.append(
            {
                "id": message.id,
                "source": "assistant",
                "created_at": message.created_at,
                "risk_level": None,
                "fraud_type": None,
                "summary": message.content,
                "snapshot": snapshot,
            }
        )

    items.sort(
        key=lambda item: item.get("created_at") or _utcnow(),
        reverse=True,
    )
    return items[:normalized_limit]


def get_user_memory_document(
    db: Session,
    *,
    user_id: uuid.UUID,
    history_limit: int = 20,
) -> dict[str, Any]:
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        raise ValueError(f"user not found: {user_id}")

    memory_path = get_user_memory_path(user.id)
    if not memory_path.exists():
        _sync_user_memory_markdown(db, user=user)
    markdown = _read_utf8_text(memory_path) or ""
    updated_at = None
    try:
        updated_at = datetime.fromtimestamp(memory_path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        updated_at = None

    return {
        "path": _display_path(memory_path),
        "updated_at": updated_at,
        "markdown": markdown,
        "history": list_user_memory_history(db, user_id=user.id, limit=history_limit),
    }
