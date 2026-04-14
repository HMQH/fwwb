"""文本规则分析：输出软规则特征，而不是只靠硬命中累加。"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class RuleHit:
    name: str
    category: str
    risk_points: int
    explanation: str
    matched_texts: list[str]
    stage_tag: str | None = None
    fraud_type_hint: str | None = None


@dataclass(slots=True)
class RuleAnalysis:
    normalized_text: str
    rule_score: int
    hit_rules: list[str]
    stage_tags: list[str]
    fraud_type_hints: list[str]
    rule_hits: list[RuleHit]
    extracted_entities: dict[str, list[str]]
    input_highlights: list[dict[str, str]]
    search_keywords: list[str]
    soft_signals: dict[str, float]
    score_breakdown: dict[str, Any]
    risk_evidence: list[str] = field(default_factory=list)
    counter_evidence: list[str] = field(default_factory=list)
    scoring_mode: str = "lexical"

    def to_json(self) -> dict:
        return {
            "normalized_text": self.normalized_text,
            "rule_score": self.rule_score,
            "hit_rules": self.hit_rules,
            "stage_tags": self.stage_tags,
            "fraud_type_hints": self.fraud_type_hints,
            "rule_hits": [asdict(item) for item in self.rule_hits],
            "extracted_entities": self.extracted_entities,
            "input_highlights": self.input_highlights,
            "search_keywords": self.search_keywords,
            "soft_signals": self.soft_signals,
            "score_breakdown": self.score_breakdown,
            "risk_evidence": self.risk_evidence,
            "counter_evidence": self.counter_evidence,
            "scoring_mode": self.scoring_mode,
        }


@dataclass(frozen=True, slots=True)
class RuleDef:
    name: str
    category: str
    risk_points: int
    explanation: str
    patterns: tuple[str, ...]
    signal_key: str
    stage_tag: str | None = None
    fraud_type_hint: str | None = None


_URL_RE = re.compile(r"https?://[^\s]+|www\.[^\s]+", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?<!\d)1\d{10}(?!\d)")
_MONEY_RE = re.compile(r"(?:￥|¥)?\d+(?:\.\d{1,2})?(?:元|块|万元|万|rmb)?", re.IGNORECASE)
_CODE_RE = re.compile(r"(?<!\d)\d{4,8}(?!\d)")

_RULES: tuple[RuleDef, ...] = (
    RuleDef(
        name="索要验证码",
        category="credential",
        risk_points=28,
        explanation="验证码、动态码、短信码通常只能本人使用，被索要时风险极高。",
        patterns=("验证码", "校验码", "动态码", "短信码", "安全码"),
        signal_key="credential_request",
        stage_tag="payment",
        fraud_type_hint="账号接管",
    ),
    RuleDef(
        name="要求转账付款",
        category="payment",
        risk_points=24,
        explanation="要求直接转账、垫付、充值或扫码付款，是常见诈骗落点。",
        patterns=("转账", "汇款", "垫付", "充值", "付款", "打款", "扫码支付", "先付"),
        signal_key="transfer_request",
        stage_tag="payment",
        fraud_type_hint="资金诈骗",
    ),
    RuleDef(
        name="制造紧急压力",
        category="pressure",
        risk_points=16,
        explanation="利用冻结、限时、立即处理等语言制造恐慌和时间压力。",
        patterns=("立即", "马上", "立刻", "否则", "冻结", "过时不候", "今天内", "尽快处理"),
        signal_key="urgency_pressure",
        stage_tag="pressure",
        fraud_type_hint="紧急施压",
    ),
    RuleDef(
        name="身份冒充",
        category="impersonation",
        risk_points=18,
        explanation="冒充客服、平台、公检法、领导亲友是常见信任建立手法。",
        patterns=("客服", "平台客服", "官方客服", "公安", "警察", "法院", "检察院", "银联", "银行工作人员", "领导"),
        signal_key="impersonation",
        stage_tag="hook",
        fraud_type_hint="身份冒充",
    ),
    RuleDef(
        name="引导下载或点击链接",
        category="redirect",
        risk_points=20,
        explanation="诱导点击链接、下载APP、安装软件，往往用于钓鱼或远控。",
        patterns=("点击链接", "打开链接", "下载", "安装", "app", "网址", "浏览器打开", "二维码"),
        signal_key="download_redirect",
        stage_tag="instruction",
        fraud_type_hint="钓鱼链接",
    ),
    RuleDef(
        name="索要敏感信息",
        category="privacy",
        risk_points=18,
        explanation="银行卡、身份证、密码、手机号等敏感信息不应在陌生沟通中提供。",
        patterns=("银行卡", "身份证", "密码", "开户行", "手机号", "银行卡号", "cvv", "有效期"),
        signal_key="privacy_request",
        stage_tag="instruction",
        fraud_type_hint="隐私窃取",
    ),
    RuleDef(
        name="远程控制或共享屏幕",
        category="remote_control",
        risk_points=22,
        explanation="共享屏幕、远程协助、会议投屏等常用于接管设备和账户。",
        patterns=("共享屏幕", "远程控制", "远程协助", "会议号", "投屏", "协助操作"),
        signal_key="remote_control",
        stage_tag="instruction",
        fraud_type_hint="远程控制",
    ),
    RuleDef(
        name="刷单返利 / 兼职诱导",
        category="part_time",
        risk_points=22,
        explanation="刷单、返佣、兼职日结等是高频诈骗话术。",
        patterns=("刷单", "返利", "返佣", "兼职", "日结", "做任务", "点赞赚钱"),
        signal_key="part_time_bait",
        stage_tag="hook",
        fraud_type_hint="刷单返利",
    ),
    RuleDef(
        name="投资理财诱导",
        category="investment",
        risk_points=22,
        explanation="内幕消息、稳赚不赔、导师带单等投资话术风险极高。",
        patterns=("投资", "理财", "带单", "导师", "内幕", "稳赚", "数字货币", "虚拟币"),
        signal_key="investment_bait",
        stage_tag="hook",
        fraud_type_hint="投资理财",
    ),
    RuleDef(
        name="退款售后诱导",
        category="after_sale",
        risk_points=16,
        explanation="快递丢失、理赔退款、售后补偿等场景常被冒充客服利用。",
        patterns=("退款", "理赔", "快递", "售后", "补偿", "退费", "误操作"),
        signal_key="after_sale_pretext",
        stage_tag="hook",
        fraud_type_hint="冒充客服",
    ),
    RuleDef(
        name="要求保密",
        category="cover_up",
        risk_points=12,
        explanation="让你不要告诉家人或警方，往往是在切断核实渠道。",
        patterns=("不要告诉", "保密", "别和别人说", "不要报警", "私下处理"),
        signal_key="secrecy_isolation",
        stage_tag="cover_up",
        fraud_type_hint="隔离核验",
    ),
)

_RULE_MAP = {rule.name: rule for rule in _RULES}

_POSITIVE_SIGNAL_WEIGHTS: dict[str, float] = {
    "credential_request": 0.16,
    "transfer_request": 0.16,
    "download_redirect": 0.12,
    "remote_control": 0.10,
    "impersonation": 0.08,
    "urgency_pressure": 0.08,
    "privacy_request": 0.07,
    "part_time_bait": 0.05,
    "investment_bait": 0.05,
    "after_sale_pretext": 0.04,
    "secrecy_isolation": 0.04,
    "entity_risk": 0.03,
    "action_density": 0.06,
}

_NEGATED_SIGNAL_PATTERNS: dict[str, tuple[str, ...]] = {
    "credential_request": (
        r"(?:不要|别|切勿|请勿|千万别|谨防)[^。！？\n]{0,14}(?:提供|发送|告诉|泄露|输入)?[^。！？\n]{0,8}(?:验证码|校验码|动态码|短信码|安全码)",
    ),
    "transfer_request": (
        r"(?:不要|别|切勿|请勿|千万别|谨防)[^。！？\n]{0,12}(?:转账|汇款|付款|打款|扫码支付|垫付|充值)",
    ),
    "download_redirect": (
        r"(?:不要|别|切勿|请勿|千万别|谨防)[^。！？\n]{0,12}(?:点击链接|打开链接|下载|安装|扫码|访问网址)",
    ),
    "remote_control": (
        r"(?:不要|别|切勿|请勿|千万别|谨防)[^。！？\n]{0,12}(?:共享屏幕|远程控制|远程协助|投屏)",
    ),
    "privacy_request": (
        r"(?:不要|别|切勿|请勿|千万别|谨防)[^。！？\n]{0,12}(?:提供|透露|泄露|填写)?[^。！？\n]{0,8}(?:银行卡|身份证|密码|银行卡号|cvv|有效期)",
    ),
}

_SAFETY_CONTEXT_PATTERNS: tuple[str, ...] = (
    r"谨防诈骗",
    r"防诈骗",
    r"反诈",
    r"反诈骗",
    r"不要轻信",
    r"提高警惕",
    r"小心被骗",
    r"陌生链接",
    r"陌生来电",
    r"诈骗提醒",
    r"风险提示",
    r"预警",
    r"警方提示",
)

_OFFICIAL_VERIFY_PATTERNS: tuple[str, ...] = (
    r"官方渠道",
    r"官方客服(?:电话)?",
    r"官方(?:APP|应用|网站|热线)",
    r"自行核实",
    r"二次确认",
    r"拨打官方",
    r"联系客服核实",
    r"通过官方",
    r"报警",
)

_SIGNAL_LABELS: dict[str, str] = {
    "credential_request": "索要验证码",
    "transfer_request": "要求转账",
    "urgency_pressure": "紧急施压",
    "impersonation": "身份冒充",
    "download_redirect": "下载跳转",
    "privacy_request": "索要敏感信息",
    "remote_control": "远程控制",
    "part_time_bait": "刷单兼职",
    "investment_bait": "投资理财诱导",
    "after_sale_pretext": "退款售后诱导",
    "secrecy_isolation": "要求保密",
    "anti_fraud_context": "反诈提醒",
    "negation_safety": "明确劝阻风险操作",
    "official_verification_guidance": "建议官方核验",
    "entity_risk": "高风险实体",
    "action_density": "高危动作叠加",
}

_ACTION_SIGNALS = (
    "credential_request",
    "transfer_request",
    "download_redirect",
    "remote_control",
    "privacy_request",
)


def normalize_text(text: str) -> str:
    normalized = re.sub(r"[\t\r\n]+", "\n", text or "")
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r"[ \u3000]{2,}", " ", normalized)
    return normalized.strip()


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _round4(value: float) -> float:
    return round(_clamp01(value), 4)


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def _unique_highlights(values: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, str]] = []
    for item in values:
        text = str(item.get("text") or "").strip()
        reason = str(item.get("reason") or "").strip()
        key = (text, reason)
        if not text or key in seen:
            continue
        seen.add(key)
        result.append({"text": text, "reason": reason})
    return result


def _collect_entities(text: str) -> dict[str, list[str]]:
    urls = _unique_keep_order(_URL_RE.findall(text))
    phones = _unique_keep_order(_PHONE_RE.findall(text))
    money = _unique_keep_order(_MONEY_RE.findall(text))
    codes = []
    if any(token in text for token in ("验证码", "校验码", "动态码", "短信码")):
        codes = _unique_keep_order(_CODE_RE.findall(text))
    return {
        "urls": urls,
        "phones": phones,
        "money": money,
        "codes": codes,
    }


def _match_rule(text: str, rule: RuleDef) -> RuleHit | None:
    matches: list[str] = []
    lowered = text.lower()
    for pattern in rule.patterns:
        if pattern.lower() in lowered:
            matches.append(pattern)
    matches = _unique_keep_order(matches)
    if not matches:
        return None
    return RuleHit(
        name=rule.name,
        category=rule.category,
        risk_points=rule.risk_points,
        explanation=rule.explanation,
        matched_texts=matches,
        stage_tag=rule.stage_tag,
        fraud_type_hint=rule.fraud_type_hint,
    )


def _build_hit_index(rule_hits: list[RuleHit]) -> dict[str, RuleHit]:
    return {hit.name: hit for hit in rule_hits}


def _rule_signal_strength(
    hit_index: dict[str, RuleHit],
    *rule_names: str,
    entity_boost: float = 0.0,
) -> float:
    hits = [hit_index[name] for name in rule_names if name in hit_index]
    if not hits and entity_boost <= 0:
        return 0.0
    matched_terms = sum(len(hit.matched_texts) for hit in hits)
    strength = len(hits) * 0.46 + min(matched_terms, 4) * 0.12 + entity_boost
    return _clamp01(strength)


def _regex_strength(text: str, patterns: tuple[str, ...]) -> tuple[float, list[str]]:
    fragments: list[str] = []
    total_matches = 0
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            fragment = match.group(0).strip()
            if not fragment:
                continue
            fragments.append(fragment)
            total_matches += 1
    fragments = _unique_keep_order(fragments)
    strength = _clamp01(len(fragments) * 0.42 + min(total_matches, 5) * 0.08)
    return strength, fragments


def _derive_safety_signals(text: str) -> tuple[dict[str, float], dict[str, list[str]]]:
    negation_strengths: dict[str, float] = {}
    negation_fragments: list[str] = []
    for signal_key, patterns in _NEGATED_SIGNAL_PATTERNS.items():
        strength, fragments = _regex_strength(text, patterns)
        negation_strengths[signal_key] = strength
        negation_fragments.extend(fragments)

    anti_fraud_context, anti_fraud_fragments = _regex_strength(text, _SAFETY_CONTEXT_PATTERNS)
    official_verify, official_fragments = _regex_strength(text, _OFFICIAL_VERIFY_PATTERNS)
    negation_safety = max(negation_strengths.values(), default=0.0)

    signals = {
        "anti_fraud_context": anti_fraud_context,
        "negation_safety": negation_safety,
        "official_verification_guidance": official_verify,
    }
    fragments = {
        "anti_fraud_context": anti_fraud_fragments,
        "negation_safety": _unique_keep_order(negation_fragments),
        "official_verification_guidance": official_fragments,
    }
    return signals, fragments


def _derive_positive_signals(
    text: str,
    hit_index: dict[str, RuleHit],
    entities: dict[str, list[str]],
) -> dict[str, float]:
    base_signals = {
        "credential_request": _rule_signal_strength(
            hit_index,
            "索要验证码",
            entity_boost=min(len(entities["codes"]), 2) * 0.18,
        ),
        "transfer_request": _rule_signal_strength(
            hit_index,
            "要求转账付款",
            entity_boost=min(len(entities["money"]), 2) * 0.12,
        ),
        "urgency_pressure": _rule_signal_strength(hit_index, "制造紧急压力"),
        "impersonation": _rule_signal_strength(hit_index, "身份冒充", "退款售后诱导"),
        "download_redirect": _rule_signal_strength(
            hit_index,
            "引导下载或点击链接",
            entity_boost=min(len(entities["urls"]), 2) * 0.16,
        ),
        "privacy_request": _rule_signal_strength(
            hit_index,
            "索要敏感信息",
            entity_boost=min(len(entities["phones"]), 2) * 0.08,
        ),
        "remote_control": _rule_signal_strength(hit_index, "远程控制或共享屏幕"),
        "part_time_bait": _rule_signal_strength(hit_index, "刷单返利 / 兼职诱导"),
        "investment_bait": _rule_signal_strength(hit_index, "投资理财诱导"),
        "after_sale_pretext": _rule_signal_strength(hit_index, "退款售后诱导"),
        "secrecy_isolation": _rule_signal_strength(hit_index, "要求保密"),
        "entity_risk": _clamp01(
            min(len(entities["urls"]), 2) * 0.28
            + min(len(entities["phones"]), 2) * 0.16
            + min(len(entities["money"]), 2) * 0.18
            + min(len(entities["codes"]), 2) * 0.32
        ),
    }

    safety_signals, _ = _derive_safety_signals(text)
    anti_fraud = safety_signals["anti_fraud_context"]
    official_verify = safety_signals["official_verification_guidance"]
    negation_safety = safety_signals["negation_safety"]

    attenuated: dict[str, float] = {}
    for key, value in base_signals.items():
        attenuation = 1.0
        if key in _NEGATED_SIGNAL_PATTERNS:
            negation_strength, _ = _regex_strength(text, _NEGATED_SIGNAL_PATTERNS[key])
            attenuation -= negation_strength * 0.78
        attenuation -= anti_fraud * (0.16 if key in _ACTION_SIGNALS else 0.22)
        attenuation -= official_verify * 0.10
        if key in {"entity_risk", "urgency_pressure"}:
            attenuation = max(0.24, attenuation)
        else:
            attenuation = max(0.12, attenuation)
        attenuated[key] = _round4(value * attenuation)

    action_count = sum(1 for key in _ACTION_SIGNALS if attenuated.get(key, 0.0) >= 0.34)
    combo_bonus = 1 if attenuated["credential_request"] >= 0.52 and (
        attenuated["download_redirect"] >= 0.42
        or attenuated["transfer_request"] >= 0.42
        or attenuated["remote_control"] >= 0.42
    ) else 0
    attenuated["action_density"] = _round4(action_count * 0.22 + combo_bonus * 0.18 - negation_safety * 0.1)
    return attenuated


def _score_soft_signals(soft_signals: dict[str, float]) -> tuple[int, dict[str, float]]:
    weighted_positive = sum(
        soft_signals.get(signal_key, 0.0) * weight
        for signal_key, weight in _POSITIVE_SIGNAL_WEIGHTS.items()
    )
    primary_action_max = max((soft_signals.get(key, 0.0) for key in _ACTION_SIGNALS), default=0.0)
    critical_stack = (
        soft_signals.get("credential_request", 0.0) >= 0.58
        and (
            soft_signals.get("download_redirect", 0.0) >= 0.45
            or soft_signals.get("transfer_request", 0.0) >= 0.45
            or soft_signals.get("remote_control", 0.0) >= 0.45
        )
    )
    safety_penalty = (
        soft_signals.get("anti_fraud_context", 0.0) * 0.24
        + soft_signals.get("negation_safety", 0.0) * 0.32
        + soft_signals.get("official_verification_guidance", 0.0) * 0.16
    )
    positive_composite = (
        weighted_positive
        + primary_action_max * 0.24
        + soft_signals.get("action_density", 0.0) * 0.10
        + (0.08 if critical_stack else 0.0)
    )
    final_score = max(0, min(100, round((positive_composite - safety_penalty) * 100)))
    return final_score, {
        "positive_weighted_score": round(weighted_positive * 100, 2),
        "primary_action_max": round(primary_action_max * 100, 2),
        "action_density_score": round(soft_signals.get("action_density", 0.0) * 100, 2),
        "critical_stack_bonus": 8.0 if critical_stack else 0.0,
        "safety_penalty_score": round(safety_penalty * 100, 2),
    }


def _build_safety_highlights(safety_fragments: dict[str, list[str]]) -> list[dict[str, str]]:
    highlights: list[dict[str, str]] = []
    for fragment in safety_fragments.get("negation_safety", [])[:2]:
        highlights.append({"text": fragment, "reason": "文本在提醒用户不要执行高风险操作。"})
    for fragment in safety_fragments.get("anti_fraud_context", [])[:2]:
        highlights.append({"text": fragment, "reason": "文本带有反诈提醒或风险提示语境。"})
    for fragment in safety_fragments.get("official_verification_guidance", [])[:2]:
        highlights.append({"text": fragment, "reason": "文本建议通过官方渠道再次核实。"})
    return highlights


def _build_highlights(
    rule_hits: list[RuleHit],
    entities: dict[str, list[str]],
    safety_fragments: dict[str, list[str]],
) -> list[dict[str, str]]:
    highlights: list[dict[str, str]] = []
    for hit in rule_hits:
        for fragment in hit.matched_texts[:3]:
            highlights.append({
                "text": fragment,
                "reason": hit.explanation,
            })
    for url in entities.get("urls", [])[:2]:
        highlights.append({"text": url, "reason": "文本中出现链接，需核实是否为官方地址。"})
    for phone in entities.get("phones", [])[:2]:
        highlights.append({"text": phone, "reason": "文本中出现手机号，需核验是否为官方号码。"})
    highlights.extend(_build_safety_highlights(safety_fragments))
    return _unique_highlights(highlights)[:8]


def _build_search_keywords(
    text: str,
    rule_hits: list[RuleHit],
    entities: dict[str, list[str]],
    soft_signals: dict[str, float],
) -> list[str]:
    keywords: list[str] = []
    for hit in rule_hits:
        keywords.append(hit.name)
        keywords.extend(hit.matched_texts[:3])
        if hit.fraud_type_hint:
            keywords.append(hit.fraud_type_hint)
    for values in entities.values():
        keywords.extend(values[:3])
    for signal_key, label in _SIGNAL_LABELS.items():
        if soft_signals.get(signal_key, 0.0) >= 0.55:
            keywords.append(label)

    for candidate in re.findall(r"[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9._-]{2,20}", text):
        if len(candidate) >= 2:
            keywords.append(candidate)
    return _unique_keep_order(keywords)[:14]


def build_rule_catalog() -> list[dict[str, Any]]:
    return [
        {
            "name": item.name,
            "category": item.category,
            "risk_points": item.risk_points,
            "explanation": item.explanation,
            "signal_key": item.signal_key,
            "stage_tag": item.stage_tag,
            "fraud_type_hint": item.fraud_type_hint,
            "patterns": list(item.patterns),
        }
        for item in _RULES
    ]


def build_search_keywords(
    text: str,
    rule_hits: list[RuleHit],
    entities: dict[str, list[str]],
    soft_signals: dict[str, float],
) -> list[str]:
    return _build_search_keywords(text, rule_hits, entities, soft_signals)


def score_soft_signals(soft_signals: dict[str, float]) -> tuple[int, dict[str, float]]:
    return _score_soft_signals(soft_signals)


def dedupe_strings(values: list[str]) -> list[str]:
    return _unique_keep_order(values)


def dedupe_highlights(values: list[dict[str, str]]) -> list[dict[str, str]]:
    return _unique_highlights(values)


def clip_signal(value: float) -> float:
    return _round4(value)


def action_signal_keys() -> tuple[str, ...]:
    return _ACTION_SIGNALS


def signal_labels() -> dict[str, str]:
    return dict(_SIGNAL_LABELS)


def rule_map() -> dict[str, RuleDef]:
    return dict(_RULE_MAP)


def analyze_text(text: str) -> RuleAnalysis:
    normalized = normalize_text(text)
    if not normalized:
        return RuleAnalysis(
            normalized_text="",
            rule_score=0,
            hit_rules=[],
            stage_tags=[],
            fraud_type_hints=[],
            rule_hits=[],
            extracted_entities={"urls": [], "phones": [], "money": [], "codes": []},
            input_highlights=[],
            search_keywords=[],
            soft_signals={},
            score_breakdown={},
            risk_evidence=[],
            counter_evidence=[],
            scoring_mode="lexical",
        )

    entities = _collect_entities(normalized)
    hits = [hit for hit in (_match_rule(normalized, rule) for rule in _RULES) if hit is not None]
    hit_index = _build_hit_index(hits)

    positive_signals = _derive_positive_signals(normalized, hit_index, entities)
    safety_signals, safety_fragments = _derive_safety_signals(normalized)
    soft_signals = {
        **positive_signals,
        **{key: _round4(value) for key, value in safety_signals.items()},
    }
    rule_score, score_components = _score_soft_signals(soft_signals)

    visible_threshold = 0.45 if (
        soft_signals.get("anti_fraud_context", 0.0) >= 0.55
        or soft_signals.get("negation_safety", 0.0) >= 0.45
    ) else 0.26
    visible_hits = [
        hit
        for hit in hits
        if soft_signals.get(_RULE_MAP[hit.name].signal_key, 0.0) >= visible_threshold
    ]
    hit_rules = _unique_keep_order([hit.name for hit in visible_hits])
    stage_tags = _unique_keep_order([hit.stage_tag for hit in visible_hits if hit.stage_tag])
    fraud_type_hints = _unique_keep_order([hit.fraud_type_hint for hit in visible_hits if hit.fraud_type_hint])
    input_highlights = _build_highlights(hits, entities, safety_fragments)
    search_keywords = _build_search_keywords(normalized, visible_hits, entities, soft_signals)

    dominant_signals = [
        _SIGNAL_LABELS.get(signal_key, signal_key)
        for signal_key, score in soft_signals.items()
        if score >= 0.55
    ]
    risk_evidence = dominant_signals[:3]
    counter_evidence: list[str] = []
    if soft_signals.get("negation_safety", 0.0) >= 0.45:
        counter_evidence.append("明确劝阻操作")
    if soft_signals.get("anti_fraud_context", 0.0) >= 0.45:
        counter_evidence.append("反诈提醒语境")
    if soft_signals.get("official_verification_guidance", 0.0) >= 0.45:
        counter_evidence.append("建议官方核实")

    return RuleAnalysis(
        normalized_text=normalized,
        rule_score=rule_score,
        hit_rules=hit_rules,
        stage_tags=stage_tags,
        fraud_type_hints=fraud_type_hints,
        rule_hits=hits,
        extracted_entities=entities,
        input_highlights=input_highlights,
        search_keywords=search_keywords,
        soft_signals=soft_signals,
        score_breakdown={
            **score_components,
            "dominant_signals": dominant_signals[:6],
        },
        risk_evidence=_unique_keep_order(risk_evidence)[:3],
        counter_evidence=_unique_keep_order(counter_evidence)[:3],
        scoring_mode="lexical",
    )
