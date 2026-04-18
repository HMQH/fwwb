from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from app.shared.user_roles import normalize_user_role

_PROMPT_FILE = Path(__file__).resolve().parents[4] / "文档" / "个性化提示词.txt"
_SECTION_RE = re.compile(r"^\s*\d+\.\s*(.+?)\s*$", re.MULTILINE)

_ROLE_SECTION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "elder": ("老年人群", "老年"),
    "minor": ("未成年人群", "未成年"),
    "student": ("大学生群体", "大学生"),
    "office_worker": ("上班族群体", "上班族"),
    "mother": ("宝妈与家庭照护群体", "宝妈"),
    "investor": ("投资理财关注群体", "投资"),
    "finance": ("商户与企业财务群体", "财务"),
    "young_social": ("社交活跃群体", "潮流青年", "社交活跃"),
}


@lru_cache(maxsize=1)
def _load_prompt_sections() -> dict[str, str]:
    try:
        text = _PROMPT_FILE.read_text(encoding="utf-8")
    except OSError:
        return {}

    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        return {}

    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        title = match.group(1).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections[title] = body
    return sections


@lru_cache(maxsize=1)
def load_role_prompt_map() -> dict[str, str]:
    sections = _load_prompt_sections()
    if not sections:
        return {}

    role_prompts: dict[str, str] = {}
    for role, keywords in _ROLE_SECTION_KEYWORDS.items():
        for title, body in sections.items():
            if any(keyword in title for keyword in keywords):
                role_prompts[role] = body
                break
    return role_prompts


def get_role_personalized_prompt(role: str | None) -> str | None:
    normalized_role = normalize_user_role(role)
    if not normalized_role:
        return None
    return load_role_prompt_map().get(normalized_role)
