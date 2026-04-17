from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from urllib import error as urllib_error
from urllib import request as urllib_request

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.domain.guardians.entity import GuardianBinding, GuardianRiskEvent
from app.domain.user import repository as user_repository
from app.shared.core.config import settings

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _post_expo_push(messages: list[dict]) -> list[dict]:
    payload = json.dumps(messages).encode("utf-8")
    req = urllib_request.Request(
        settings.expo_push_api_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=8) as response:
        raw = response.read().decode("utf-8")
    parsed = json.loads(raw)
    data = parsed.get("data")
    return data if isinstance(data, list) else []


def _trim_body(value: str, limit: int = 120) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _dispatch_push_notifications(
    db: Session,
    *,
    event: GuardianRiskEvent,
    binding: GuardianBinding,
) -> None:
    if not settings.expo_push_enabled or binding.guardian_user_id is None:
        return

    try:
        rows = user_repository.list_active_push_tokens_for_user(db, user_id=binding.guardian_user_id)
    except SQLAlchemyError as exc:
        logger.warning("guardian push token query failed: event=%s error=%s", event.id, exc)
        return
    if not rows:
        return

    ward = user_repository.get_by_id(db, event.ward_user_id)
    ward_name = ward.display_name if ward is not None else "被监护人"
    messages = [
        {
            "to": row.expo_push_token,
            "sound": "default",
            "priority": "high",
            "channelId": "guardian-risk-alerts",
            "title": f"{ward_name} 风险提醒",
            "body": _trim_body(event.summary or "检测到高风险事件，请尽快处理。"),
            "data": {
                "type": "guardian_risk_event",
                "event_id": str(event.id),
                "risk_level": event.risk_level,
                "ward_display_name": ward_name,
                "summary": event.summary,
            },
        }
        for row in rows
    ]

    try:
        results = _post_expo_push(messages)
    except (urllib_error.URLError, TimeoutError, ValueError) as exc:
        logger.warning("guardian expo push failed: event=%s error=%s", event.id, exc)
        return

    for row, result in zip(rows, results):
        if not isinstance(result, dict):
            continue
        if result.get("status") == "error":
            details = result.get("details")
            if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
                try:
                    row.is_active = False
                    user_repository.save_push_token(db, row)
                    logger.info("guardian expo push token deactivated: user=%s", row.user_id)
                except SQLAlchemyError as exc:
                    logger.warning("guardian push token deactivate failed: user=%s error=%s", row.user_id, exc)


def dispatch_guardian_event(
    db: Session,
    *,
    event: GuardianRiskEvent,
    binding: GuardianBinding,
) -> GuardianRiskEvent:
    event.notify_status = "sent"
    event.notified_at = _utcnow()
    db.add(event)
    db.commit()
    db.refresh(event)
    _dispatch_push_notifications(db, event=event, binding=binding)
    logger.info(
        "guardian event sent: event=%s ward=%s guardian_phone=%s",
        event.id,
        event.ward_user_id,
        binding.guardian_phone,
    )
    return event
