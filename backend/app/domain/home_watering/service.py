from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.domain.home_watering import repository
from app.domain.user import repository as user_repository
from app.shared.core.config import settings

logger = logging.getLogger(__name__)

_SAFETY_GAIN_BY_SOURCE: dict[str, int] = {
    "quiz": 2,
    "case": 1,
}


def _clamp_score(value: int) -> int:
    return max(0, min(100, int(value)))


def _calc_learning_safety_delta(*, current: int, source: str, units: int) -> int:
    base = int(_SAFETY_GAIN_BY_SOURCE.get(source, 0))
    if base <= 0:
        return 0
    scaled = base * max(1, min(5, int(units or 1)))
    if current >= 99:
        return 0
    if current >= 96:
        scaled = max(1, round(scaled * 0.4))
    elif current >= 90:
        scaled = max(1, round(scaled * 0.65))
    return max(0, min(100 - current, scaled))


def _apply_learning_safety_gain(
    db: Session,
    *,
    user_id: uuid.UUID,
    source: str,
    units: int,
    created: bool,
) -> None:
    if not created:
        return
    user = user_repository.get_by_id(db, user_id)
    if user is None:
        return
    current = _clamp_score(
        user.safety_score if isinstance(user.safety_score, int) else settings.user_profile_default_safety_score
    )
    delta = _calc_learning_safety_delta(current=current, source=source, units=units)
    if delta <= 0:
        return
    user.safety_score = _clamp_score(current + delta)
    user_repository.save(db, user)


def get_watering_status(db: Session, *, user_id: uuid.UUID) -> dict[str, int]:
    return repository.get_watering_status(db, user_id=user_id)


def grant_reward(
    db: Session,
    *,
    user_id: uuid.UUID,
    source: str,
    units: int,
    dedupe_key: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event, created = repository.create_reward_event(
        db,
        user_id=user_id,
        source=source,
        units=units,
        dedupe_key=dedupe_key,
        payload=payload,
    )
    try:
        _apply_learning_safety_gain(
            db,
            user_id=user_id,
            source=source,
            units=units,
            created=created,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Home watering safety gain failed: user_id=%s source=%s", user_id, source)
    status = repository.get_watering_status(db, user_id=user_id)
    return {
        "created": created,
        "event": event,
        "pending_count": int(status["pending_count"]),
        "pending_units": int(status["pending_units"]),
    }


def claim_rewards(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> dict[str, Any]:
    return repository.claim_pending_events(db, user_id=user_id, limit=limit)
