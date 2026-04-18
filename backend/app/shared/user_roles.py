from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

USER_ROLES = (
    "office_worker",
    "student",
    "mother",
    "investor",
    "minor",
    "young_social",
    "elder",
    "finance",
)

UserRole = Literal[
    "office_worker",
    "student",
    "mother",
    "investor",
    "minor",
    "young_social",
    "elder",
    "finance",
]

USER_ROLE_LABELS: dict[str, str] = {
    "office_worker": "上班族",
    "student": "大学生",
    "mother": "宝妈",
    "investor": "投资者",
    "minor": "未成年",
    "young_social": "潮流青年",
    "elder": "老年人",
    "finance": "财务",
}

LEGACY_ROLE_TO_USER_ROLE: dict[str, str] = {
    "child": "minor",
    "youth": "office_worker",
    "elder": "elder",
}

MINOR_ROLE_KEYS = {"minor"}


def normalize_user_role(role: str | None) -> str | None:
    if role is None:
        return None
    normalized = str(role).strip()
    if not normalized:
        return None
    return LEGACY_ROLE_TO_USER_ROLE.get(normalized, normalized)


def normalize_user_roles(values: Iterable[str] | None) -> list[str]:
    if values is None:
        return []

    items: list[str] = []
    seen: set[str] = set()
    for raw in values:
        normalized = normalize_user_role(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        items.append(normalized)
    return items


def role_matches(role: str | None, candidate_roles: Iterable[str] | None) -> bool:
    normalized_role = normalize_user_role(role)
    if not normalized_role:
        return False
    return normalized_role in set(normalize_user_roles(candidate_roles))


def is_minor_role(role: str | None) -> bool:
    normalized_role = normalize_user_role(role)
    return normalized_role in MINOR_ROLE_KEYS
