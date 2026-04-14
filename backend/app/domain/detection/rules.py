"""文本规则分析：先给检测链路一层稳定的规则底座。"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass


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
        }


@dataclass(frozen=True, slots=True)
class RuleDef:
    name: str
    category: str
    risk_points: int
    explanation: str
    patterns: tuple[str, ...]
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
        stage_tag="payment",
        fraud_type_hint="账号接管",
    ),
    RuleDef(
        name="要求转账付款",
        category="payment",
        risk_points=24,
        explanation="要求直接转账、垫付、充值或扫码付款，是常见诈骗落点。",
        patterns=("转账", "汇款", "垫付", "充值", "付款", "打款", "扫码支付", "先付"),
        stage_tag="payment",
        fraud_type_hint="资金诈骗",
    ),
    RuleDef(
        name="制造紧急压力",
        category="pressure",
        risk_points=16,
        explanation="利用冻结、限时、立即处理等语言制造恐慌和时间压力。",
        patterns=("立即", "马上", "立刻", "否则", "冻结", "过时不候", "今天内", "尽快处理"),
        stage_tag="pressure",
        fraud_type_hint="紧急施压",
    ),
    RuleDef(
        name="身份冒充",
        category="impersonation",
        risk_points=18,
        explanation="冒充客服、平台、公检法、领导亲友是常见信任建立手法。",
        patterns=("客服", "官方", "平台", "公安", "警察", "法院", "检察院", "银联", "银行工作人员", "领导"),
        stage_tag="hook",
        fraud_type_hint="身份冒充",
    ),
    RuleDef(
        name="引导下载或点击链接",
        category="redirect",
        risk_points=20,
        explanation="诱导点击链接、下载APP、安装软件，往往用于钓鱼或远控。",
        patterns=("点击链接", "打开链接", "下载", "安装", "app", "网址", "浏览器打开", "二维码"),
        stage_tag="instruction",
        fraud_type_hint="钓鱼链接",
    ),
    RuleDef(
        name="索要敏感信息",
        category="privacy",
        risk_points=18,
        explanation="银行卡、身份证、密码、手机号等敏感信息不应在陌生沟通中提供。",
        patterns=("银行卡", "身份证", "密码", "开户行", "手机号", "银行卡号", "cvv", "有效期"),
        stage_tag="instruction",
        fraud_type_hint="隐私窃取",
    ),
    RuleDef(
        name="远程控制或共享屏幕",
        category="remote_control",
        risk_points=22,
        explanation="共享屏幕、远程协助、会议投屏等常用于接管设备和账户。",
        patterns=("共享屏幕", "远程控制", "远程协助", "会议号", "投屏", "协助操作"),
        stage_tag="instruction",
        fraud_type_hint="远程控制",
    ),
    RuleDef(
        name="刷单返利 / 兼职诱导",
        category="part_time",
        risk_points=22,
        explanation="刷单、返佣、兼职日结等是高频诈骗话术。",
        patterns=("刷单", "返利", "返佣", "兼职", "日结", "做任务", "点赞赚钱"),
        stage_tag="hook",
        fraud_type_hint="刷单返利",
    ),
    RuleDef(
        name="投资理财诱导",
        category="investment",
        risk_points=22,
        explanation="内幕消息、稳赚不赔、导师带单等投资话术风险极高。",
        patterns=("投资", "理财", "带单", "导师", "内幕", "稳赚", "数字货币", "虚拟币"),
        stage_tag="hook",
        fraud_type_hint="投资理财",
    ),
    RuleDef(
        name="退款售后诱导",
        category="after_sale",
        risk_points=16,
        explanation="快递丢失、理赔退款、售后补偿等场景常被冒充客服利用。",
        patterns=("退款", "理赔", "快递", "售后", "补偿", "退费", "误操作"),
        stage_tag="hook",
        fraud_type_hint="冒充客服",
    ),
    RuleDef(
        name="要求保密",
        category="cover_up",
        risk_points=12,
        explanation="让你不要告诉家人或警方，往往是在切断核实渠道。",
        patterns=("不要告诉", "保密", "别和别人说", "不要报警", "私下处理"),
        stage_tag="cover_up",
        fraud_type_hint="隔离核验",
    ),
)


def normalize_text(text: str) -> str:
    normalized = re.sub(r"[\t\r\n]+", "\n", text or "")
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r"[ \u3000]{2,}", " ", normalized)
    return normalized.strip()


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


def _build_highlights(rule_hits: list[RuleHit], entities: dict[str, list[str]]) -> list[dict[str, str]]:
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
    return highlights[:8]


def _build_search_keywords(text: str, rule_hits: list[RuleHit], entities: dict[str, list[str]]) -> list[str]:
    keywords: list[str] = []
    for hit in rule_hits:
        keywords.append(hit.name)
        keywords.extend(hit.matched_texts[:3])
        if hit.fraud_type_hint:
            keywords.append(hit.fraud_type_hint)
    for values in entities.values():
        keywords.extend(values[:3])

    for candidate in re.findall(r"[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9._-]{2,20}", text):
        if len(candidate) >= 2:
            keywords.append(candidate)
    return _unique_keep_order(keywords)[:12]


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
        )

    entities = _collect_entities(normalized)
    hits = [hit for hit in (_match_rule(normalized, rule) for rule in _RULES) if hit is not None]

    # 实体本身也能抬高风险分，但不重复计算太多。
    entity_score = 0
    if entities["urls"]:
        entity_score += 6
    if entities["phones"]:
        entity_score += 4
    if entities["money"]:
        entity_score += 6
    if entities["codes"]:
        entity_score += 10

    rule_score = min(100, sum(hit.risk_points for hit in hits) + entity_score)
    hit_rules = _unique_keep_order([hit.name for hit in hits])
    stage_tags = _unique_keep_order([hit.stage_tag for hit in hits if hit.stage_tag])
    fraud_type_hints = _unique_keep_order([hit.fraud_type_hint for hit in hits if hit.fraud_type_hint])
    input_highlights = _build_highlights(hits, entities)
    search_keywords = _build_search_keywords(normalized, hits, entities)

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
    )
