from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

_SCHEMA_READY = False
_ALLOWED_SOURCES = {"quiz", "guardian", "case"}


def ensure_home_watering_schema(db: Session) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    statements = [
        """
        CREATE TABLE IF NOT EXISTS public.home_watering_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          source text NOT NULL,
          units integer NOT NULL DEFAULT 1,
          dedupe_key text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          consumed boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          consumed_at timestamptz NULL,
          CONSTRAINT home_watering_events_source_check CHECK (source IN ('quiz', 'guardian', 'case')),
          CONSTRAINT home_watering_events_units_check CHECK (units >= 1 AND units <= 5)
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_home_watering_events_user_dedupe
          ON public.home_watering_events (user_id, dedupe_key)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_home_watering_events_user_pending
          ON public.home_watering_events (user_id, consumed, created_at)
        """,
        """
        CREATE TABLE IF NOT EXISTS public.home_watering_state (
          user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
          water_total integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT home_watering_state_water_total_check CHECK (water_total >= 0)
        )
        """,
    ]
    for statement in statements:
        db.execute(text(statement))
    db.commit()
    _SCHEMA_READY = True


def _normalize_source(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in _ALLOWED_SOURCES:
        raise ValueError("unsupported reward source")
    return normalized


def _normalize_units(value: int) -> int:
    try:
        units = int(value)
    except (TypeError, ValueError):
        units = 1
    return max(1, min(5, units))


def _normalize_dedupe_key(*, source: str, dedupe_key: str | None) -> str:
    normalized = str(dedupe_key or "").strip()
    if normalized:
        return normalized
    return f"{source}:{uuid.uuid4()}"


def create_reward_event(
    db: Session,
    *,
    user_id: uuid.UUID,
    source: str,
    units: int,
    dedupe_key: str | None,
    payload: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], bool]:
    ensure_home_watering_schema(db)
    normalized_source = _normalize_source(source)
    normalized_units = _normalize_units(units)
    normalized_dedupe = _normalize_dedupe_key(source=normalized_source, dedupe_key=dedupe_key)
    payload_obj = dict(payload or {})

    insert_stmt = text(
        """
        INSERT INTO public.home_watering_events (user_id, source, units, dedupe_key, payload)
        VALUES (:user_id, :source, :units, :dedupe_key, CAST(:payload AS jsonb))
        RETURNING id, source, units, dedupe_key, consumed, created_at
        """
    )
    params = {
        "user_id": user_id,
        "source": normalized_source,
        "units": normalized_units,
        "dedupe_key": normalized_dedupe,
        "payload": json.dumps(payload_obj, ensure_ascii=False),
    }
    try:
        row = db.execute(insert_stmt, params).mappings().one()
        db.commit()
        return dict(row), True
    except IntegrityError:
        db.rollback()
        existing = db.execute(
            text(
                """
                SELECT id, source, units, dedupe_key, consumed, created_at
                FROM public.home_watering_events
                WHERE user_id = :user_id AND dedupe_key = :dedupe_key
                LIMIT 1
                """
            ),
            {"user_id": user_id, "dedupe_key": normalized_dedupe},
        ).mappings().first()
        if existing is None:
            raise
        return dict(existing), False


def _get_state_water_total(db: Session, *, user_id: uuid.UUID) -> int:
    water_total = db.execute(
        text(
            """
            SELECT water_total
            FROM public.home_watering_state
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).scalar_one_or_none()
    return max(0, int(water_total or 0))


def _get_pending_stats(db: Session, *, user_id: uuid.UUID) -> tuple[int, int]:
    row = db.execute(
        text(
            """
            SELECT COUNT(*) AS pending_count, COALESCE(SUM(units), 0) AS pending_units
            FROM public.home_watering_events
            WHERE user_id = :user_id AND consumed = false
            """
        ),
        {"user_id": user_id},
    ).mappings().one()
    return int(row["pending_count"] or 0), int(row["pending_units"] or 0)


def get_watering_status(db: Session, *, user_id: uuid.UUID) -> dict[str, int]:
    ensure_home_watering_schema(db)
    pending_count, pending_units = _get_pending_stats(db, user_id=user_id)
    water_total = _get_state_water_total(db, user_id=user_id)
    return {
        "water_total": water_total,
        "pending_count": pending_count,
        "pending_units": pending_units,
    }


def claim_pending_events(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int = 64,
) -> dict[str, Any]:
    ensure_home_watering_schema(db)
    normalized_limit = max(1, min(120, int(limit)))

    rows = list(
        db.execute(
            text(
                """
                SELECT id, source, units, dedupe_key, created_at
                FROM public.home_watering_events
                WHERE user_id = :user_id AND consumed = false
                ORDER BY created_at ASC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": normalized_limit},
        ).mappings().all()
    )
    if not rows:
        pending_count, pending_units = _get_pending_stats(db, user_id=user_id)
        return {
            "events": [],
            "claimed_units": 0,
            "water_total": _get_state_water_total(db, user_id=user_id),
            "pending_count": pending_count,
            "pending_units": pending_units,
        }

    event_ids = [row["id"] for row in rows]
    update_stmt = text(
        """
        UPDATE public.home_watering_events
        SET consumed = true, consumed_at = now()
        WHERE id IN :event_ids
        """
    ).bindparams(bindparam("event_ids", expanding=True))
    db.execute(update_stmt, {"event_ids": event_ids})

    claimed_units = sum(int(row["units"] or 0) for row in rows)
    water_total_row = db.execute(
        text(
            """
            INSERT INTO public.home_watering_state (user_id, water_total, updated_at)
            VALUES (:user_id, :delta, now())
            ON CONFLICT (user_id) DO UPDATE
            SET water_total = public.home_watering_state.water_total + EXCLUDED.water_total,
                updated_at = now()
            RETURNING water_total
            """
        ),
        {"user_id": user_id, "delta": claimed_units},
    ).mappings().one()
    db.commit()

    pending_count, pending_units = _get_pending_stats(db, user_id=user_id)
    return {
        "events": [dict(row) for row in rows],
        "claimed_units": claimed_units,
        "water_total": int(water_total_row["water_total"] or 0),
        "pending_count": pending_count,
        "pending_units": pending_units,
    }
