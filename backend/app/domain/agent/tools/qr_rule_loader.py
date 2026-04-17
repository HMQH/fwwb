from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.shared.db.session import SessionLocal


@dataclass(slots=True)
class QRDomainRule:
    category: str
    match_type: str
    pattern: str
    display_name: str
    risk_weight: float
    priority: int


@dataclass(slots=True)
class QRKeywordRule:
    category: str
    keyword: str
    risk_weight: float
    priority: int


_DEFAULT_DOMAIN_RULES: list[QRDomainRule] = [
    QRDomainRule("official", "suffix", "gov.cn", "政府网站", 0.0, 10),
    QRDomainRule("official", "suffix", "court.gov.cn", "法院网站", 0.0, 20),
    QRDomainRule("official", "contains", "police.", "公安网站", 0.0, 30),
    QRDomainRule("official", "contains", "ga.", "公安网站", 0.0, 40),
    QRDomainRule("platform", "suffix", "qq.com", "QQ/腾讯网站", 0.0, 100),
    QRDomainRule("platform", "suffix", "wechat.com", "微信网站", 0.0, 110),
    QRDomainRule("platform", "suffix", "weixin.qq.com", "微信网站", 0.0, 120),
    QRDomainRule("platform", "suffix", "alipay.com", "支付宝网站", 0.0, 130),
    QRDomainRule("platform", "suffix", "taobao.com", "淘宝网站", 0.0, 140),
    QRDomainRule("platform", "suffix", "tmall.com", "天猫网站", 0.0, 150),
    QRDomainRule("shortener", "contains", "url.cn", "短链跳转网站", 0.1, 200),
    QRDomainRule("shortener", "contains", "t.cn", "短链跳转网站", 0.1, 210),
    QRDomainRule("shortener", "contains", "dwz", "短链跳转网站", 0.1, 220),
    QRDomainRule("shortener", "contains", "bit.ly", "短链跳转网站", 0.1, 230),
]

_DEFAULT_KEYWORD_RULES: list[QRKeywordRule] = [
    QRKeywordRule("sensitive_action", "login", 0.2, 10),
    QRKeywordRule("sensitive_action", "verify", 0.2, 20),
    QRKeywordRule("sensitive_action", "payment", 0.2, 30),
    QRKeywordRule("sensitive_action", "refund", 0.2, 40),
    QRKeywordRule("sensitive_action", "transfer", 0.2, 50),
    QRKeywordRule("sensitive_action", "wallet", 0.2, 60),
]


def _normalize_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_int(value: Any, default: int = 100) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_qr_domain_rules() -> tuple[list[QRDomainRule], list[str]]:
    warnings: list[str] = []
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                """
                SELECT category, match_type, pattern, display_name, risk_weight, priority
                FROM public.qr_domain_rules
                WHERE enabled = TRUE
                ORDER BY category, priority, id
                """
            )
        ).mappings().all()
        if not rows:
            warnings.append("qr_domain_rules is empty; using built-in fallback rules.")
            return list(_DEFAULT_DOMAIN_RULES), warnings
        return (
            [
                QRDomainRule(
                    category=str(row.get("category") or "").strip(),
                    match_type=str(row.get("match_type") or "").strip(),
                    pattern=str(row.get("pattern") or "").strip().lower(),
                    display_name=str(row.get("display_name") or "").strip() or "未命名规则",
                    risk_weight=_normalize_float(row.get("risk_weight"), 0.0),
                    priority=_normalize_int(row.get("priority"), 100),
                )
                for row in rows
                if str(row.get("pattern") or "").strip()
            ],
            warnings,
        )
    except SQLAlchemyError as exc:
        warnings.append(f"Unable to load qr_domain_rules; using built-in fallback rules. {type(exc).__name__}: {exc}")
        return list(_DEFAULT_DOMAIN_RULES), warnings
    finally:
        db.close()


def load_qr_keyword_rules() -> tuple[list[QRKeywordRule], list[str]]:
    warnings: list[str] = []
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                """
                SELECT category, keyword, risk_weight, priority
                FROM public.qr_keyword_rules
                WHERE enabled = TRUE
                ORDER BY category, priority, id
                """
            )
        ).mappings().all()
        if not rows:
            warnings.append("qr_keyword_rules is empty; using built-in fallback rules.")
            return list(_DEFAULT_KEYWORD_RULES), warnings
        return (
            [
                QRKeywordRule(
                    category=str(row.get("category") or "").strip(),
                    keyword=str(row.get("keyword") or "").strip().lower(),
                    risk_weight=_normalize_float(row.get("risk_weight"), 0.2),
                    priority=_normalize_int(row.get("priority"), 100),
                )
                for row in rows
                if str(row.get("keyword") or "").strip()
            ],
            warnings,
        )
    except SQLAlchemyError as exc:
        warnings.append(f"Unable to load qr_keyword_rules; using built-in fallback rules. {type(exc).__name__}: {exc}")
        return list(_DEFAULT_KEYWORD_RULES), warnings
    finally:
        db.close()
