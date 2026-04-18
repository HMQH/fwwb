"""反诈学习与案例频道共用的诈骗大类映射。"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from app.shared.user_roles import normalize_user_role, role_matches

RECOMMENDED_CATEGORY_KEY = "recommended"


@dataclass(frozen=True, slots=True)
class FraudTopicDefinition:
    key: str
    label: str
    description: str
    simulation_persona: str
    aliases: tuple[str, ...]
    fine_types: tuple[str, ...]


FRAUD_TOPIC_DEFINITIONS: tuple[FraudTopicDefinition, ...] = (
    FraudTopicDefinition(
        key="financial_fraud",
        label="金融诈骗",
        description="投资、返利、贷款、充值",
        simulation_persona="投资导师",
        aliases=("投资", "理财", "返利", "贷款", "充值", "高收益", "刷单", "荐股", "带单", "平台"),
        fine_types=("虚假投资诈骗",),
    ),
    FraudTopicDefinition(
        key="social_fraud",
        label="社交诈骗",
        description="婚恋、交友、引流、群聊",
        simulation_persona="社交引流人员",
        aliases=("社交", "交友", "婚恋", "群聊", "直播间", "引流", "网友", "杀猪盘", "跨境"),
        fine_types=("跨境电诈", "电信网络诈骗"),
    ),
    FraudTopicDefinition(
        key="impersonation_fraud",
        label="冒充诈骗",
        description="客服、亲友、公检法、熟人",
        simulation_persona="冒充客服",
        aliases=("冒充", "客服", "亲友", "公检法", "领导", "老师", "警察", "拟声", "熟人"),
        fine_types=("AI拟声冒充亲友",),
    ),
    FraudTopicDefinition(
        key="transaction_fraud",
        label="交易诈骗",
        description="订单、跑分、银行卡、代付",
        simulation_persona="交易客服",
        aliases=("交易", "订单", "退款", "理赔", "代购", "跑分", "银行卡", "两卡", "收款", "押金"),
        fine_types=("洗钱跑分", "两卡帮信"),
    ),
    FraudTopicDefinition(
        key="job_fraud",
        label="招聘诈骗",
        description="兼职、培训、就业、学费",
        simulation_persona="招聘专员",
        aliases=("招聘", "兼职", "培训", "学费", "就业", "内推", "实习", "培训费"),
        fine_types=("求职培训诈骗",),
    ),
    FraudTopicDefinition(
        key="livelihood_fraud",
        label="民生诈骗",
        description="补贴、保健品、医托、消费",
        simulation_persona="补贴专员",
        aliases=("补贴", "养老金", "保健品", "医托", "赛事", "民生", "报名费", "骗保", "押金"),
        fine_types=("骗保骗补", "民生消费诈骗"),
    ),
    FraudTopicDefinition(
        key="other_fraud",
        label="其他诈骗",
        description="其他风险场景",
        simulation_persona="陌生联系人",
        aliases=("诈骗", "电诈", "陌生来电", "陌生链接"),
        fine_types=(),
    ),
)

_TOPIC_BY_KEY = {item.key: item for item in FRAUD_TOPIC_DEFINITIONS}
_FINE_TYPE_TO_TOPIC = {
    fine_type: definition
    for definition in FRAUD_TOPIC_DEFINITIONS
    for fine_type in definition.fine_types
}

_ROLE_TOPIC_PRIORITY: dict[str, dict[str, int]] = {
    "minor": {
        "social_fraud": 4,
        "impersonation_fraud": 3,
        "transaction_fraud": 3,
        "job_fraud": 1,
        "financial_fraud": 1,
        "livelihood_fraud": 1,
        "other_fraud": 1,
    },
    "student": {
        "job_fraud": 4,
        "transaction_fraud": 4,
        "social_fraud": 3,
        "financial_fraud": 2,
        "impersonation_fraud": 2,
        "livelihood_fraud": 1,
        "other_fraud": 1,
    },
    "office_worker": {
        "impersonation_fraud": 4,
        "financial_fraud": 4,
        "transaction_fraud": 3,
        "social_fraud": 2,
        "livelihood_fraud": 1,
        "job_fraud": 1,
        "other_fraud": 1,
    },
    "young_social": {
        "social_fraud": 4,
        "financial_fraud": 3,
        "transaction_fraud": 3,
        "impersonation_fraud": 2,
        "job_fraud": 2,
        "livelihood_fraud": 1,
        "other_fraud": 1,
    },
    "mother": {
        "transaction_fraud": 4,
        "impersonation_fraud": 3,
        "livelihood_fraud": 3,
        "financial_fraud": 2,
        "social_fraud": 2,
        "job_fraud": 1,
        "other_fraud": 1,
    },
    "investor": {
        "financial_fraud": 4,
        "social_fraud": 3,
        "impersonation_fraud": 2,
        "transaction_fraud": 2,
        "livelihood_fraud": 1,
        "job_fraud": 1,
        "other_fraud": 1,
    },
    "elder": {
        "impersonation_fraud": 4,
        "livelihood_fraud": 4,
        "financial_fraud": 3,
        "social_fraud": 2,
        "transaction_fraud": 2,
        "job_fraud": 1,
        "other_fraud": 1,
    },
    "finance": {
        "impersonation_fraud": 4,
        "transaction_fraud": 4,
        "financial_fraud": 3,
        "social_fraud": 1,
        "livelihood_fraud": 1,
        "job_fraud": 1,
        "other_fraud": 1,
    },
}


def list_learning_topics() -> list[FraudTopicDefinition]:
    return list(FRAUD_TOPIC_DEFINITIONS)


def get_topic_definition(key: str | None) -> FraudTopicDefinition:
    if key and key in _TOPIC_BY_KEY:
        return _TOPIC_BY_KEY[key]
    return _TOPIC_BY_KEY["other_fraud"]


def resolve_learning_topic(
    *,
    fraud_type: str | None,
    title: str | None = None,
    summary: str | None = None,
    tags: Iterable[str] | None = None,
) -> FraudTopicDefinition:
    if fraud_type and fraud_type in _FINE_TYPE_TO_TOPIC:
        return _FINE_TYPE_TO_TOPIC[fraud_type]

    text_parts = [
        fraud_type or "",
        title or "",
        summary or "",
        *(list(tags or [])),
    ]
    haystack = " ".join(text_parts)
    for definition in FRAUD_TOPIC_DEFINITIONS:
        if any(alias and alias in haystack for alias in definition.aliases):
            return definition
    return _TOPIC_BY_KEY["other_fraud"]


def case_matches_learning_topic(case: Any, topic_key: str | None) -> bool:
    if not topic_key or topic_key == RECOMMENDED_CATEGORY_KEY:
        return True
    topic = resolve_learning_topic(
        fraud_type=getattr(case, "fraud_type", None),
        title=getattr(case, "title", None),
        summary=getattr(case, "summary", None),
        tags=getattr(case, "tags", None),
    )
    return topic.key == topic_key


def topic_priority_for_role(topic_key: str, role: str | None) -> int:
    normalized_role = normalize_user_role(role)
    if not normalized_role:
        return 1
    return _ROLE_TOPIC_PRIORITY.get(normalized_role, {}).get(topic_key, 1)


def recommendation_score(case: Any, role: str | None) -> int:
    topic = resolve_learning_topic(
        fraud_type=getattr(case, "fraud_type", None),
        title=getattr(case, "title", None),
        summary=getattr(case, "summary", None),
        tags=getattr(case, "tags", None),
    )
    score = 0
    if bool(getattr(case, "is_featured", False)):
        score += 36
    score += topic_priority_for_role(topic.key, role) * 10
    if role_matches(role, list(getattr(case, "target_roles", []) or [])):
        score += 18
    if getattr(case, "cover_url", None):
        score += 6
    tags = list(getattr(case, "tags", []) or [])
    if "案例预警" in tags:
        score += 4
    if "时事热点" in tags:
        score += 3
    return score


def build_case_categories(cases: Iterable[Any]) -> list[dict[str, Any]]:
    counts = {definition.key: 0 for definition in FRAUD_TOPIC_DEFINITIONS}
    total = 0
    for case in cases:
        total += 1
        topic = resolve_learning_topic(
            fraud_type=getattr(case, "fraud_type", None),
            title=getattr(case, "title", None),
            summary=getattr(case, "summary", None),
            tags=getattr(case, "tags", None),
        )
        counts[topic.key] = counts.get(topic.key, 0) + 1

    items: list[dict[str, Any]] = [
        {"key": RECOMMENDED_CATEGORY_KEY, "label": "推荐", "count": total},
    ]
    for definition in FRAUD_TOPIC_DEFINITIONS:
        items.append(
            {
                "key": definition.key,
                "label": definition.label,
                "count": counts.get(definition.key, 0),
            }
        )
    return items
