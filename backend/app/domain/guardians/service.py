from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.detection import repository as detection_repository
from app.domain.detection.entity import DetectionResult, DetectionSubmission
from app.domain.guardians import notifier, repository
from app.domain.guardians.entity import GuardianBinding, GuardianIntervention, GuardianRiskEvent
from app.domain.user import repository as user_repository
from app.domain.user.entity import User

_PHONE_RE = re.compile(r"^1\d{10}$")
_RELATION_SET = {"self", "parent", "spouse", "child", "relative"}
_ACTION_TYPE_SET = {"call", "message", "mark_safe", "suggest_alarm", "remote_assist"}
_AUTO_NOTIFY_LEVELS = {"high"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: str | None, *, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if max_length is not None:
        cleaned = cleaned[:max_length].strip()
    return cleaned or None


def _normalize_relation(value: str) -> str:
    cleaned = _clean_text(value, max_length=24) or ""
    if cleaned not in _RELATION_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="监护关系无效")
    return cleaned


def _normalize_phone(value: str) -> str:
    cleaned = _clean_text(value, max_length=11) or ""
    if not _PHONE_RE.match(cleaned):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="监护人手机号无效")
    return cleaned


def _normalize_notify_levels(scope: dict[str, Any] | None) -> list[str]:
    if not isinstance(scope, dict):
        return list(_AUTO_NOTIFY_LEVELS)
    raw_levels = scope.get("notify_levels")
    if not isinstance(raw_levels, list):
        return list(_AUTO_NOTIFY_LEVELS)
    result: list[str] = []
    for item in raw_levels:
        normalized = _clean_text(str(item), max_length=12)
        if normalized in {"medium", "high"} and normalized not in result:
            result.append(normalized)
    return result or list(_AUTO_NOTIFY_LEVELS)


def _build_consent_scope(scope: dict[str, Any] | None) -> dict[str, Any]:
    return {"notify_levels": _normalize_notify_levels(scope)}


def _is_ward(binding: GuardianBinding, current_user: User) -> bool:
    return binding.ward_user_id == current_user.id


def _is_guardian(binding: GuardianBinding, current_user: User) -> bool:
    return binding.guardian_user_id == current_user.id or binding.guardian_phone == current_user.phone


def _binding_ownership(binding: GuardianBinding, current_user: User) -> str:
    ward = _is_ward(binding, current_user)
    guardian = _is_guardian(binding, current_user)
    if ward and guardian:
        return "self"
    if ward:
        return "ward"
    if guardian:
        return "guardian"
    return "viewer"


def _user_display_name(db: Session, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    user = user_repository.get_by_id(db, user_id)
    return user.display_name if user is not None else None


def _user_phone(db: Session, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    user = user_repository.get_by_id(db, user_id)
    return user.phone if user is not None else None


def _binding_snapshot(db: Session, binding: GuardianBinding, *, current_user: User) -> dict[str, Any]:
    return {
        "id": binding.id,
        "ward_user_id": binding.ward_user_id,
        "guardian_user_id": binding.guardian_user_id,
        "ward_display_name": _user_display_name(db, binding.ward_user_id),
        "ward_phone": _user_phone(db, binding.ward_user_id),
        "guardian_display_name": _user_display_name(db, binding.guardian_user_id) or binding.guardian_name,
        "guardian_phone": binding.guardian_phone,
        "guardian_name": binding.guardian_name,
        "relation": binding.relation,
        "status": binding.status,
        "is_primary": binding.is_primary,
        "consent_scope": dict(binding.consent_scope or {}),
        "verified_at": binding.verified_at,
        "ownership": _binding_ownership(binding, current_user),
        "created_at": binding.created_at,
        "updated_at": binding.updated_at,
    }


def _intervention_snapshot(db: Session, row: GuardianIntervention) -> dict[str, Any]:
    return {
        "id": row.id,
        "risk_event_id": row.risk_event_id,
        "actor_user_id": row.actor_user_id,
        "actor_display_name": _user_display_name(db, row.actor_user_id),
        "action_type": row.action_type,
        "status": row.status,
        "payload": dict(row.payload or {}),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _event_snapshot(
    db: Session,
    event: GuardianRiskEvent,
    binding: GuardianBinding,
    *,
    current_user: User,
    include_actions: bool,
) -> dict[str, Any]:
    payload = {
        "id": event.id,
        "ward_user_id": event.ward_user_id,
        "ward_display_name": _user_display_name(db, event.ward_user_id),
        "ward_phone": _user_phone(db, event.ward_user_id),
        "guardian_binding_id": event.guardian_binding_id,
        "guardian_name": binding.guardian_name or _user_display_name(db, binding.guardian_user_id),
        "guardian_phone": binding.guardian_phone,
        "guardian_relation": binding.relation,
        "binding_status": binding.status,
        "ownership": _binding_ownership(binding, current_user),
        "submission_id": event.submission_id,
        "detection_result_id": event.detection_result_id,
        "risk_level": event.risk_level,
        "fraud_type": event.fraud_type,
        "summary": event.summary,
        "evidence_json": dict(event.evidence_json or {}),
        "notify_status": event.notify_status,
        "notified_at": event.notified_at,
        "acknowledged_at": event.acknowledged_at,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "interventions": [],
    }
    if include_actions:
        payload["interventions"] = [
            _intervention_snapshot(db, row)
            for row in repository.list_interventions_for_event(db, event_id=event.id)
        ]
    return payload


def _event_summary_snapshot(
    event: GuardianRiskEvent,
    binding: GuardianBinding,
    *,
    event_count: int,
) -> dict[str, Any]:
    return {
        "event_count": event_count,
        "latest_event_id": event.id,
        "latest_risk_level": event.risk_level,
        "latest_notify_status": event.notify_status,
        "latest_guardian_name": binding.guardian_name,
        "latest_guardian_phone": binding.guardian_phone,
        "latest_guardian_relation": binding.relation,
        "latest_created_at": event.created_at,
        "latest_acknowledged_at": event.acknowledged_at,
    }


def _build_event_evidence(result: DetectionResult) -> dict[str, Any]:
    rule_hits = []
    for item in list(result.rule_hits or [])[:4]:
        if not isinstance(item, dict):
            continue
        rule_hits.append(
            {
                "name": str(item.get("name", "")).strip(),
                "explanation": str(item.get("explanation", "")).strip(),
            }
        )
    highlights = []
    for item in list(result.input_highlights or [])[:4]:
        if not isinstance(item, dict):
            continue
        highlights.append(
            {
                "text": str(item.get("text", "")).strip(),
                "reason": str(item.get("reason", "")).strip(),
            }
        )
    return {
        "summary": result.summary,
        "final_reason": result.final_reason,
        "advice": list(result.advice or [])[:3],
        "stage_tags": list(result.stage_tags or [])[:4],
        "hit_rules": list(result.hit_rules or [])[:4],
        "rule_hits": rule_hits,
        "input_highlights": highlights,
    }


def _ensure_primary_flag(db: Session, *, ward_user_id: uuid.UUID, target_binding_id: uuid.UUID) -> None:
    bindings = repository.list_bindings_for_ward(db, ward_user_id=ward_user_id)
    changed = False
    for binding in bindings:
        next_value = binding.id == target_binding_id
        if binding.is_primary != next_value:
            binding.is_primary = next_value
            db.add(binding)
            changed = True
    if changed:
        db.commit()


def list_bindings(db: Session, *, current_user: User) -> list[dict[str, Any]]:
    rows = repository.list_bindings_visible_to_user(db, user_id=current_user.id, phone=current_user.phone)
    return [_binding_snapshot(db, row, current_user=current_user) for row in rows]


def create_binding(
    db: Session,
    *,
    current_user: User,
    guardian_phone: str,
    guardian_name: str | None,
    relation: str,
    consent_scope: dict[str, Any] | None,
    is_primary: bool,
) -> dict[str, Any]:
    normalized_phone = _normalize_phone(guardian_phone)
    normalized_relation = _normalize_relation(relation)
    if repository.find_open_binding(
        db,
        ward_user_id=current_user.id,
        guardian_phone=normalized_phone,
        relation=normalized_relation,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该监护人已绑定")

    guardian_user = user_repository.get_by_phone(db, normalized_phone)
    is_self_binding = normalized_phone == current_user.phone
    row = GuardianBinding(
        ward_user_id=current_user.id,
        guardian_user_id=guardian_user.id if guardian_user else None,
        guardian_phone=normalized_phone,
        guardian_name=_clean_text(guardian_name, max_length=32),
        relation=normalized_relation,
        status="active" if is_self_binding else "pending",
        is_primary=is_primary,
        consent_scope=_build_consent_scope(consent_scope),
        verified_at=_utcnow() if is_self_binding else None,
    )
    repository.save_binding(db, row)
    if is_primary or len(repository.list_bindings_for_ward(db, ward_user_id=current_user.id)) == 1:
        _ensure_primary_flag(db, ward_user_id=current_user.id, target_binding_id=row.id)
        row = repository.get_binding_visible_to_user(
            db,
            binding_id=row.id,
            user_id=current_user.id,
            phone=current_user.phone,
        ) or row
    return _binding_snapshot(db, row, current_user=current_user)


def confirm_binding(
    db: Session,
    *,
    current_user: User,
    binding_id: uuid.UUID,
) -> dict[str, Any]:
    row = repository.get_binding_visible_to_user(
        db,
        binding_id=binding_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="监护绑定不存在")
    if not _is_guardian(row, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权确认该绑定")
    row.guardian_user_id = current_user.id
    row.status = "active"
    row.verified_at = _utcnow()
    repository.save_binding(db, row)
    return _binding_snapshot(db, row, current_user=current_user)


def revoke_binding(
    db: Session,
    *,
    current_user: User,
    binding_id: uuid.UUID,
) -> dict[str, Any]:
    row = repository.get_binding_visible_to_user(
        db,
        binding_id=binding_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="监护绑定不存在")
    if _is_ward(row, current_user):
        row.status = "revoked"
    elif _is_guardian(row, current_user):
        row.status = "rejected"
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权操作该绑定")
    repository.save_binding(db, row)
    return _binding_snapshot(db, row, current_user=current_user)


def _create_or_reuse_event(
    db: Session,
    *,
    binding: GuardianBinding,
    submission: DetectionSubmission,
    result: DetectionResult,
) -> tuple[GuardianRiskEvent, bool]:
    existing = repository.get_event_for_binding_result(
        db,
        guardian_binding_id=binding.id,
        detection_result_id=result.id,
    )
    if existing is not None:
        return existing, False
    row = GuardianRiskEvent(
        ward_user_id=submission.user_id,
        guardian_binding_id=binding.id,
        submission_id=submission.id,
        detection_result_id=result.id,
        risk_level=(result.risk_level or "medium"),
        fraud_type=result.fraud_type,
        summary=result.summary or "检测到需要监护联动的风险事件。",
        evidence_json=_build_event_evidence(result),
        notify_status="pending",
    )
    repository.save_event(db, row)
    return row, True


def _should_auto_notify(binding: GuardianBinding, *, risk_level: str | None) -> bool:
    if risk_level not in {"medium", "high"}:
        return False
    levels = set(_normalize_notify_levels(dict(binding.consent_scope or {})))
    return risk_level in levels


def maybe_create_events_for_detection_result(
    db: Session,
    *,
    submission: DetectionSubmission,
    result: DetectionResult,
) -> list[GuardianRiskEvent]:
    bindings = repository.list_active_bindings_for_ward(db, ward_user_id=submission.user_id)
    created: list[GuardianRiskEvent] = []
    for binding in bindings:
        if not _should_auto_notify(binding, risk_level=result.risk_level):
            continue
        event, is_new = _create_or_reuse_event(db, binding=binding, submission=submission, result=result)
        if is_new:
            event = notifier.dispatch_guardian_event(db, event=event, binding=binding)
        created.append(event)
    return created


def create_events_from_submission(
    db: Session,
    *,
    current_user: User,
    submission_id: uuid.UUID,
) -> list[dict[str, Any]]:
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=submission_id,
        user_id=current_user.id,
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    result = detection_repository.get_latest_result_for_submission(db, submission_id=submission.id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前记录暂无检测结果")
    bindings = repository.list_active_bindings_for_ward(db, ward_user_id=current_user.id)
    if not bindings:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先绑定可联动的监护人")

    items: list[dict[str, Any]] = []
    for binding in bindings:
        event, is_new = _create_or_reuse_event(db, binding=binding, submission=submission, result=result)
        if is_new:
            event = notifier.dispatch_guardian_event(db, event=event, binding=binding)
        items.append(_event_snapshot(db, event, binding, current_user=current_user, include_actions=False))
    return items


def list_events(
    db: Session,
    *,
    current_user: User,
    limit: int,
) -> list[dict[str, Any]]:
    rows = repository.list_events_visible_to_user(
        db,
        user_id=current_user.id,
        phone=current_user.phone,
        limit=limit,
    )
    return [
        _event_snapshot(db, event, binding, current_user=current_user, include_actions=False)
        for event, binding in rows
    ]


def get_event_detail(
    db: Session,
    *,
    current_user: User,
    event_id: uuid.UUID,
) -> dict[str, Any]:
    row = repository.get_event_visible_to_user(
        db,
        event_id=event_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="联动事件不存在")
    event, binding = row
    if _is_guardian(binding, current_user) and event.notify_status == "sent":
        event.notify_status = "read"
        event.acknowledged_at = _utcnow()
        repository.save_event(db, event)
    return _event_snapshot(db, event, binding, current_user=current_user, include_actions=True)


def create_intervention(
    db: Session,
    *,
    current_user: User,
    event_id: uuid.UUID,
    action_type: str,
    note: str | None,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    normalized_action = _clean_text(action_type, max_length=24) or ""
    if normalized_action not in _ACTION_TYPE_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="干预动作无效")
    row = repository.get_event_visible_to_user(
        db,
        event_id=event_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="联动事件不存在")
    event, binding = row

    intervention_payload = dict(payload or {})
    note_text = _clean_text(note, max_length=120)
    if note_text:
        intervention_payload["note"] = note_text

    repository.save_intervention(
        db,
        GuardianIntervention(
            risk_event_id=event.id,
            actor_user_id=current_user.id,
            action_type=normalized_action,
            status="completed",
            payload=intervention_payload,
        ),
    )

    event.notify_status = "read"
    event.acknowledged_at = _utcnow()
    repository.save_event(db, event)
    return _event_snapshot(db, event, binding, current_user=current_user, include_actions=True)


def get_submission_event_summary(
    db: Session,
    *,
    current_user: User,
    submission_id: uuid.UUID,
) -> dict[str, Any] | None:
    row = repository.get_latest_event_for_submission_visible_to_user(
        db,
        submission_id=submission_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    if row is None:
        return None
    event, binding = row
    event_count = repository.count_events_for_submission_visible_to_user(
        db,
        submission_id=submission_id,
        user_id=current_user.id,
        phone=current_user.phone,
    )
    return _event_summary_snapshot(event, binding, event_count=event_count)


def get_submission_event_summary_for_viewer(
    db: Session,
    *,
    user_id: uuid.UUID,
    phone: str,
    submission_id: uuid.UUID,
) -> dict[str, Any] | None:
    row = repository.get_latest_event_for_submission_visible_to_user(
        db,
        submission_id=submission_id,
        user_id=user_id,
        phone=phone,
    )
    if row is None:
        return None
    event, binding = row
    event_count = repository.count_events_for_submission_visible_to_user(
        db,
        submission_id=submission_id,
        user_id=user_id,
        phone=phone,
    )
    return _event_summary_snapshot(event, binding, event_count=event_count)
