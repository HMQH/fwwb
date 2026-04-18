"""学习模块的轻量运行时缓存。"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class QuizCacheItem:
    topic_key: str
    questions: list[dict[str, Any]]
    cached_at: datetime
    expires_at: datetime


@dataclass(slots=True)
class SimulationSession:
    id: str
    topic_key: str
    topic_label: str
    user_role: str | None
    persona_label: str
    created_at: datetime
    finished: bool = False
    scenario: dict[str, Any] = field(default_factory=dict)
    messages: list[dict[str, Any]] = field(default_factory=list)


_cache_lock = threading.Lock()
_quiz_cache: dict[str, QuizCacheItem] = {}
_simulation_sessions: dict[str, SimulationSession] = {}


def get_cached_quiz_questions(topic_key: str) -> list[dict[str, Any]] | None:
    with _cache_lock:
        item = _quiz_cache.get(topic_key)
        if item is None:
            return None
        if item.expires_at <= utcnow():
            _quiz_cache.pop(topic_key, None)
            return None
        return list(item.questions)


def store_quiz_questions(
    topic_key: str,
    questions: list[dict[str, Any]],
    *,
    ttl_minutes: int = 30,
) -> None:
    now = utcnow()
    with _cache_lock:
        _quiz_cache[topic_key] = QuizCacheItem(
            topic_key=topic_key,
            questions=list(questions),
            cached_at=now,
            expires_at=now + timedelta(minutes=max(5, ttl_minutes)),
        )


def create_simulation_session(
    *,
    topic_key: str,
    topic_label: str,
    user_role: str | None,
    persona_label: str,
    opening_message: str,
    scenario: dict[str, Any] | None = None,
) -> SimulationSession:
    now = utcnow()
    session = SimulationSession(
        id=str(uuid.uuid4()),
        topic_key=topic_key,
        topic_label=topic_label,
        user_role=user_role,
        persona_label=persona_label,
        created_at=now,
        scenario=dict(scenario or {}),
        messages=[
            {
                "role": "assistant",
                "content": opening_message,
                "created_at": now,
            }
        ],
    )
    with _cache_lock:
        _simulation_sessions[session.id] = session
    return session


def get_simulation_session(session_id: str) -> SimulationSession | None:
    with _cache_lock:
        return _simulation_sessions.get(session_id)


def append_simulation_message(session_id: str, *, role: str, content: str) -> SimulationSession | None:
    now = utcnow()
    with _cache_lock:
        session = _simulation_sessions.get(session_id)
        if session is None:
            return None
        session.messages.append({"role": role, "content": content, "created_at": now})
        return session


def finish_simulation_session(session_id: str) -> SimulationSession | None:
    with _cache_lock:
        session = _simulation_sessions.get(session_id)
        if session is None:
            return None
        session.finished = True
        return session
