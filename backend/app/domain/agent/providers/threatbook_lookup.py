from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.shared.core.config import settings


THREATBOOK_ENTRY_URL = "https://x.threatbook.com/"
_DEBUG_BROWSER_SESSIONS: list[dict[str, Any]] = []
_PLAYWRIGHT_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="threatbook-playwright")
_POPUP_CLOSE_TEXTS = ("关闭", "跳过", "以后再说", "我知道了", "知道了", "取消")
_STATUS_PATTERNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("malicious", ("恶意", "钓鱼", "欺诈", "高危", "危险")),
    ("suspicious", ("可疑", "风险", "异常", "失陷")),
    ("benign", ("安全", "正常", "可信", "未发现", "未见风险")),
    ("unknown", ("未知", "未收录", "暂无结论")),
)
_SEARCH_ROOT_SELECTORS = (
    ".search-bar-box:visible",
    ".x-searchBar_wrapper:visible",
    ".x-searchBar_con:visible",
)
_SEARCH_INPUT_SELECTORS = (
    "textarea.x-searchBar-input:visible",
    ".x-searchBar-input_body textarea:visible",
    "textarea.x-searchBar-input",
    ".x-searchBar-input_body textarea",
)


@dataclass(slots=True)
class ThreatBookLookupResult:
    provider: str
    status: str
    verdict: str | None
    summary: str | None
    labels: list[str]
    warnings: list[str]
    raw: dict[str, Any]


def _load_playwright():
    if sys.platform.startswith("win"):
        try:
            current_policy = asyncio.get_event_loop_policy()
            if not isinstance(current_policy, asyncio.WindowsProactorEventLoopPolicy):
                asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        except Exception:
            pass
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - runtime environment dependent
        raise RuntimeError(
            "Playwright is not installed. Run `pip install -r backend/requirements.txt` "
            "and then `python -m playwright install chromium`."
        ) from exc
    return sync_playwright, PlaywrightTimeoutError


def _safe_close(target: Any) -> None:
    try:
        target.close()
    except Exception:
        pass


def _build_launch_kwargs() -> dict[str, Any]:
    launch_kwargs: dict[str, Any] = {
        "headless": settings.threatbook_lookup_headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--lang=zh-CN",
        ],
    }
    executable_path = (settings.threatbook_lookup_executable_path or "").strip()
    if executable_path:
        launch_kwargs["executable_path"] = executable_path
    return launch_kwargs


def _storage_state_path() -> Path:
    return Path(settings.threatbook_storage_state_path).expanduser()


def _storage_state_exists() -> bool:
    try:
        return _storage_state_path().is_file()
    except Exception:
        return False


def _save_storage_state(context: Any, raw: dict[str, Any], warnings: list[str]) -> None:
    try:
        storage_path = _storage_state_path()
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(storage_path))
        raw["storage_state_path"] = str(storage_path)
        raw["storage_state_saved"] = True
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ThreatBook storage state save failed: {type(exc).__name__}: {exc}")


def _subprocess_script_path() -> Path:
    return Path(__file__).resolve().parents[4] / "scripts" / "run_threatbook_lookup.py"


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _extract_labels(text: str) -> list[str]:
    labels: list[str] = []
    for verdict, terms in _STATUS_PATTERNS:
        if any(term in text for term in terms):
            labels.append(verdict)
    return labels


def _infer_verdict(text: str) -> str | None:
    for verdict, terms in _STATUS_PATTERNS:
        if any(term in text for term in terms):
            return verdict
    return None


def _extract_summary(text: str, target_url: str) -> str | None:
    lines = [
        _normalize_whitespace(line)
        for line in str(text or "").splitlines()
        if _normalize_whitespace(line)
    ]
    kept: list[str] = []
    for line in lines:
        if target_url in line:
            continue
        if len(line) <= 2:
            continue
        kept.append(line)
        if len(kept) >= 4:
            break
    return " | ".join(kept) if kept else None


def _safe_locator_text(locator: Any, timeout_ms: int = 1200) -> str | None:
    try:
        locator.wait_for(state="attached", timeout=timeout_ms)
        return _normalize_whitespace(locator.inner_text(timeout=timeout_ms))
    except Exception:
        return None


def _parse_int(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value.replace(",", ""))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _clean_structured_value(value: str | None) -> str | None:
    text = _normalize_whitespace(value)
    if not text or text == "-":
        return None
    return text


def _parse_ratio(value: str | None) -> dict[str, int] | None:
    text = _normalize_whitespace(value)
    match = re.search(r"(\d+)\s*/\s*(\d+)", text)
    if not match:
        return None
    return {
        "detected": int(match.group(1)),
        "total": int(match.group(2)),
    }


def _map_text_verdict(value: str | None) -> str | None:
    text = _normalize_whitespace(value)
    if not text:
        return None
    if any(term in text for term in ("恶意", "钓鱼", "欺诈", "高危", "危险")):
        return "malicious"
    if any(term in text for term in ("可疑", "风险", "异常", "失陷")):
        return "suspicious"
    if any(term in text for term in ("安全", "正常", "可信", "白名单")):
        return "benign"
    if any(term in text for term in ("未知", "暂无结论", "未收录")):
        return "unknown"
    return None


def _make_tag_label(tag: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", tag.lower()).strip("_")
    return f"tag:{slug or 'unknown'}"


def _resource_matches_query(resource: str | None, target_url: str) -> bool:
    resource_text = _normalize_whitespace(resource)
    if not resource_text:
        return False
    query_host = (urlparse(target_url).netloc or "").lower()
    if not query_host:
        return False
    resource_host = (urlparse(resource_text).netloc or resource_text).strip().lower().strip("/")
    if not resource_host:
        return False
    return (
        resource_host == query_host
        or resource_host.endswith(f".{query_host}")
        or query_host.endswith(f".{resource_host}")
    )


def _extract_page_risk_terms(text: str) -> list[str]:
    labels: list[str] = []
    normalized = _normalize_whitespace(text)
    if any(term in normalized for term in ("恶意", "钓鱼", "欺诈", "高危", "危险")):
        labels.append("page_contains_risk_terms")
    if any(term in normalized for term in ("安全", "正常", "可信", "白名单")):
        labels.append("page_contains_benign_terms")
    return labels


def _build_structured_summary(parsed: dict[str, Any]) -> str | None:
    if not parsed:
        return None

    header = parsed.get("header") or {}
    counts = parsed.get("counts") or {}
    insight = parsed.get("intel_insight") or {}
    pieces: list[str] = []

    verdict_text = header.get("verdict_text")
    resource = header.get("resource")
    if verdict_text or resource:
        left = "ThreatBook判定"
        if verdict_text:
            left += f"：{verdict_text}"
        if resource:
            left += f"（{resource}）"
        pieces.append(left)

    tags = header.get("tags") or []
    if tags:
        pieces.append(f"标签：{'、'.join(str(tag) for tag in tags[:4])}")

    count_parts: list[str] = []
    mapping = (
        ("related_urls", "相关URL"),
        ("resolved_ip_count", "解析IP数"),
        ("related_samples", "相关样本"),
        ("subdomain_count", "子域名数"),
    )
    for key, label in mapping:
        value = counts.get(key)
        if value is not None:
            count_parts.append(f"{label}{value}")
    if count_parts:
        pieces.append("；".join(count_parts))

    suspicious_count = insight.get("suspicious_feature_count")
    if suspicious_count:
        pieces.append(f"情报洞察：{suspicious_count}条可疑特征")

    return "；".join(pieces) if pieces else None


def _build_url_report_summary(parsed: dict[str, Any]) -> str | None:
    report = parsed.get("url_report") or {}
    intelligence = report.get("intelligence") or {}
    phishing = report.get("phishing_model") or {}
    multi = report.get("multi_engine") or {}
    http_response = report.get("http_response") or {}

    pieces: list[str] = []
    verdict_text = intelligence.get("verdict_text")
    resource = intelligence.get("resource")
    if verdict_text or resource:
        left = "ThreatBook情报检测"
        if verdict_text:
            left += f"：{verdict_text}"
        if resource:
            left += f"（{resource}）"
        pieces.append(left)

    intel_contents = intelligence.get("intel_contents") or []
    if intel_contents:
        pieces.append(f"情报内容：{'、'.join(intel_contents[:4])}")

    model_verdict = phishing.get("model_verdict")
    if model_verdict:
        pieces.append(f"钓鱼模型：{model_verdict}")

    ratio_text = multi.get("detection_ratio")
    if ratio_text:
        pieces.append(f"引擎检出：{ratio_text}")

    status_code = http_response.get("status_code")
    if status_code:
        pieces.append(f"HTTP状态：{status_code}")

    return "；".join(pieces) if pieces else None


def _wait_for_final_report(page: Any, timeout_ms: int) -> list[str]:
    warnings: list[str] = []
    deadline_ms = max(2500, min(timeout_ms, 6000))
    start = page.evaluate("Date.now()")
    required_checks = [
        ("#urlReports", lambda: page.locator("#urlReports").first.is_visible()),
        (
            "#intelligence verdict",
            lambda: bool(_safe_locator_text(page.locator("#intelligence .styles_resultItem__e2d9i .styles_value__gjCib").first, 500)),
        ),
        (
            "#fishingModel verdict",
            lambda: bool(_safe_locator_text(page.locator("#fishingModel .styles_item__R_Bqj .styles_detect__MX6MQ").first, 500)),
        ),
        (
            "#multiEngine ratio",
            lambda: bool(_safe_locator_text(page.locator("#multiEngine .styles_count____3lM").first, 500)),
        ),
        (
            "#HTTPResponse status",
            lambda: bool(_safe_locator_text(page.locator("#HTTPResponse .styles_code__F4b4I").first, 500)),
        ),
    ]

    while True:
        ready = 0
        for _, check in required_checks:
            try:
                if check():
                    ready += 1
            except Exception:
                continue
        if ready >= 4:
            return warnings
        now = page.evaluate("Date.now()")
        if (now - start) >= deadline_ms:
            warnings.append("ThreatBook final report did not fully hydrate before parsing; using best-effort capture.")
            return warnings
        page.wait_for_timeout(350)


def _extract_structured_result(page: Any, timeout_ms: int) -> dict[str, Any]:
    header: dict[str, Any] = {}
    counts: dict[str, Any] = {}
    intel_items: list[dict[str, str]] = []
    suspicious_feature_count = None

    summary_card = page.locator(".summary.result-page-card").first
    try:
        summary_card.wait_for(state="visible", timeout=min(timeout_ms, 1800))

        verdict_text = _safe_locator_text(summary_card.locator(".judgments-result").first)
        resource = _safe_locator_text(summary_card.locator(".resource .ellipsis").first)
        time_info = _safe_locator_text(summary_card.locator(".time-info").first)
        updated_at = None
        if time_info:
            match = re.search(r"\d{4}-\d{2}-\d{2}", time_info)
            if match:
                updated_at = match.group(0)

        umbrella_rank = _safe_locator_text(summary_card.locator(".ranking-box.umbrella .rank").first)
        alexa_rank = _safe_locator_text(summary_card.locator(".ranking-box.alexa .rank").first)

        tags: list[str] = []
        try:
            tag_locator = summary_card.locator(".tag-list .vb-tag-common")
            for idx in range(tag_locator.count()):
                tag_text = _normalize_whitespace(tag_locator.nth(idx).inner_text(timeout=800))
                if tag_text and tag_text not in tags:
                    tags.append(tag_text)
        except Exception:
            pass

        try:
            item_locator = summary_card.locator("table.domain-count-info .count-item")
            for idx in range(item_locator.count()):
                item = item_locator.nth(idx)
                key = _safe_locator_text(item.locator(".key").first, timeout_ms=800)
                value = _safe_locator_text(item.locator(".value").first, timeout_ms=800)
                if not key or value is None:
                    continue
                counts[key] = value
        except Exception:
            pass

        insight_summary = _safe_locator_text(summary_card.locator(".result-intelInsight-summary").first)
        if insight_summary:
            suspicious_feature_count = _parse_int(insight_summary)

        try:
            insight_locator = summary_card.locator(".result-intelInsight-item-line")
            for idx in range(insight_locator.count()):
                line = insight_locator.nth(idx)
                title = _safe_locator_text(line.locator(".result-intelInsight-feature span").last, timeout_ms=800)
                description = _safe_locator_text(line.locator(".result-intelInsight-feature-desc").first, timeout_ms=800)
                if title or description:
                    intel_items.append(
                        {
                            "title": title or "",
                            "description": description or "",
                        }
                    )
        except Exception:
            pass

        header.update(
            {
                "verdict_text": verdict_text,
                "resource": resource,
                "updated_at": updated_at,
                "time_info": time_info,
                "umbrella_rank": umbrella_rank,
                "alexa_rank": alexa_rank,
                "tags": tags,
            }
        )
    except Exception:
        pass

    url_report: dict[str, Any] = {}
    report_container = page.locator("#urlReports").first
    try:
        report_container.wait_for(state="visible", timeout=min(timeout_ms, 2500))

        intelligence_section = report_container.locator("#intelligence").first
        intelligence: dict[str, Any] = {}
        try:
            result_item_locator = intelligence_section.locator(".styles_resultItem__e2d9i")
            for idx in range(result_item_locator.count()):
                item = result_item_locator.nth(idx)
                spans = item.locator("span")
                label = _clean_structured_value(_safe_locator_text(spans.first, timeout_ms=800))
                value = _clean_structured_value(_safe_locator_text(spans.last, timeout_ms=800))
                if not label:
                    continue
                label = label.rstrip("：:")
                intelligence[label] = value
        except Exception:
            pass

        intelligence_contents: list[str] = []
        try:
            content_locator = intelligence_section.locator(".tag-list .vb-tag-common")
            for idx in range(content_locator.count()):
                value = _clean_structured_value(_safe_locator_text(content_locator.nth(idx), timeout_ms=800))
                if value and value not in intelligence_contents:
                    intelligence_contents.append(value)
        except Exception:
            pass

        intelligence_resource = _clean_structured_value(
            _safe_locator_text(intelligence_section.locator("tbody tr .styles_resource__OXweQ").first, timeout_ms=1200)
        )
        intelligence_type = _clean_structured_value(
            _safe_locator_text(intelligence_section.locator("tbody tr td").nth(1), timeout_ms=1200)
        )

        url_report["intelligence"] = {
            "resource": intelligence_resource,
            "resource_type": intelligence_type,
            "verdict_text": intelligence.get("情报判定"),
            "impersonation": intelligence.get("仿冒"),
            "intel_contents": intelligence_contents,
        }

        phishing_section = report_container.locator("#fishingModel").first
        phishing_model: dict[str, Any] = {}
        try:
            item_locator = phishing_section.locator(".styles_item__R_Bqj")
            for idx in range(item_locator.count()):
                item = item_locator.nth(idx)
                label = _clean_structured_value(_safe_locator_text(item.locator(".styles_label__rUBMJ").first, timeout_ms=800))
                value = _clean_structured_value(item.locator("span").last.inner_text(timeout=800))
                if not label:
                    continue
                phishing_model[label.rstrip("：:")] = value
        except Exception:
            pass
        url_report["phishing_model"] = {
            "model_verdict": phishing_model.get("模型判定"),
            "type": phishing_model.get("类型"),
            "confidence": phishing_model.get("可信度"),
        }

        multi_engine_section = report_container.locator("#multiEngine").first
        ratio_text = None
        detected = _safe_locator_text(multi_engine_section.locator(".styles_count____3lM").first, timeout_ms=800)
        total = _safe_locator_text(multi_engine_section.locator(".styles_total__vV5CC").first, timeout_ms=800)
        if detected and total:
            ratio_text = f"{detected}{total}"
        engines: list[dict[str, str | None]] = []
        try:
            row_locator = multi_engine_section.locator("tbody tr")
            for idx in range(row_locator.count()):
                cells = row_locator.nth(idx).locator("td")
                values = []
                for cell_idx in range(cells.count()):
                    values.append(_clean_structured_value(_safe_locator_text(cells.nth(cell_idx), timeout_ms=800)))
                if len(values) >= 2 and values[0]:
                    engines.append({"engine": values[0], "result": values[1]})
                if len(values) >= 4 and values[2]:
                    engines.append({"engine": values[2], "result": values[3]})
        except Exception:
            pass
        url_report["multi_engine"] = {
            "detection_ratio": ratio_text,
            "detection_ratio_parsed": _parse_ratio(ratio_text),
            "engines": engines,
        }

        last_sample_section = report_container.locator("#lastSample").first
        last_sample: dict[str, Any] = {
            "result_text": _clean_structured_value(_safe_locator_text(last_sample_section.locator(".styles_resultText__MGJ8z").first, timeout_ms=800))
        }
        try:
            item_locator = last_sample_section.locator(".styles_item__mvnho")
            for idx in range(item_locator.count()):
                item = item_locator.nth(idx)
                label = _clean_structured_value(_safe_locator_text(item.locator(".styles_label__SAEP8").first, timeout_ms=800))
                value = _clean_structured_value(_safe_locator_text(item.locator(".styles_value__ZOfpn").first, timeout_ms=800))
                if not label:
                    continue
                last_sample[label.rstrip("：:")] = value
        except Exception:
            pass
        url_report["last_sample"] = {
            "result_text": last_sample.get("result_text"),
            "sha256": last_sample.get("SHA256"),
            "filename": last_sample.get("文件名称"),
            "analysis_environment": last_sample.get("分析环境"),
            "analysis_time": last_sample.get("分析时间"),
            "engine_detection": last_sample.get("引擎检测"),
            "engine_detection_parsed": _parse_ratio(last_sample.get("引擎检测")),
        }

        http_section = report_container.locator("#HTTPResponse").first
        http_response: dict[str, Any] = {
            "status_code": _parse_int(_safe_locator_text(http_section.locator(".styles_code__F4b4I").first, timeout_ms=800))
        }
        try:
            item_locator = http_section.locator(".styles_item__vVqH4")
            for idx in range(item_locator.count()):
                item = item_locator.nth(idx)
                label = _clean_structured_value(_safe_locator_text(item.locator(".styles_label__Ur6ni").first, timeout_ms=800))
                if not label:
                    continue
                label = label.rstrip("：:")
                if label == "响应头":
                    headers = []
                    header_locator = item.locator(".styles_headers__u60kW div")
                    for header_idx in range(header_locator.count()):
                        header_value = _clean_structured_value(_safe_locator_text(header_locator.nth(header_idx), timeout_ms=800))
                        if header_value:
                            headers.append(header_value)
                    http_response[label] = headers
                else:
                    http_response[label] = _clean_structured_value(_safe_locator_text(item.locator(".styles_value__0hwP2").first, timeout_ms=800))
        except Exception:
            pass
        url_report["http_response"] = {
            "status_code": http_response.get("status_code"),
            "final_url": http_response.get("最终URL"),
            "ip_address": http_response.get("IP地址"),
            "content_size": http_response.get("内容大小"),
            "sha256": http_response.get("SHA256"),
            "headers": http_response.get("响应头") or [],
        }

        connection_section = report_container.locator("#connectionRelation").first
        relation: dict[str, Any] = {}
        history_title = _safe_locator_text(connection_section.locator(".styles_historyDownloadSampleWrapper__GJ2zl .styles_title__eiglM").first, timeout_ms=800)
        related_title = _safe_locator_text(connection_section.locator(".styles_url__lq94R .styles_title__eiglM").first, timeout_ms=800)
        relation["history_download_sample_count"] = _parse_int(history_title)
        relation["related_url_count"] = _parse_int(related_title)
        url_report["connection_relation"] = relation
    except Exception:
        pass

    parsed: dict[str, Any] = {
        "header": header,
        "counts": {
            "related_urls": _parse_int(counts.get("相关URL")),
            "resolved_ip_count": _parse_int(counts.get("解析IP数")),
            "registered_at": counts.get("注册时间"),
            "registrar": counts.get("域名服务商"),
            "related_samples": _parse_int(counts.get("相关样本")),
            "subdomain_count": _parse_int(counts.get("子域名数")),
            "expires_at": counts.get("过期时间"),
            "registrant_email": None if counts.get("域名注册邮箱") in {"-", "", None} else counts.get("域名注册邮箱"),
            "icp": None if counts.get("ICP 备案") in {"-", "", None} else counts.get("ICP 备案"),
        },
        "intel_insight": {
            "suspicious_feature_count": suspicious_feature_count,
            "items": intel_items,
        },
        "url_report": url_report,
    }

    return parsed


def _dismiss_threatbook_popups(page: Any, timeout_ms: int) -> list[str]:
    warnings: list[str] = []
    short_timeout = max(300, min(timeout_ms, 700))

    try:
        page.keyboard.press("Escape")
    except Exception:
        pass

    close_selectors = [
        "button[aria-label*='close']",
        "button[aria-label*='Close']",
        "[role='dialog'] button",
        ".ant-modal-close",
        ".close",
        ".modal-close",
        ".popup-close",
        ".el-dialog__close",
        "button:has-text('×')",
    ]

    for selector in close_selectors:
        try:
            locator = page.locator(selector).first
            locator.wait_for(state="visible", timeout=short_timeout)
            locator.click(timeout=short_timeout)
            page.wait_for_timeout(120)
        except Exception:
            continue

    for text_value in _POPUP_CLOSE_TEXTS:
        try:
            locator = page.get_by_text(text_value, exact=False).first
            locator.wait_for(state="visible", timeout=short_timeout)
            locator.click(timeout=short_timeout)
            page.wait_for_timeout(120)
        except Exception:
            continue

    try:
        page.mouse.click(20, 20)
    except Exception:
        pass

    return warnings


def _activate_search_panel(page: Any) -> None:
    candidates = [
        page.locator(".search-bar-box .x-searchBar-input-placeholder").first,
        page.locator(".search-bar-box .x-searchBar-input_body").first,
        page.locator(".search-bar-box textarea.x-searchBar-input").first,
        page.get_by_text("搜索", exact=False).first,
        page.locator("div,span").filter(has_text="搜索威胁情报").first,
        page.locator("div,span").filter(has_text="XGPT").first,
    ]
    for candidate in candidates:
        try:
            candidate.wait_for(state="visible", timeout=1200)
            candidate.click(timeout=1200)
            page.wait_for_timeout(250)
            return
        except Exception:
            continue


def _locate_search_root(page: Any):
    for selector in _SEARCH_ROOT_SELECTORS:
        try:
            candidate = page.locator(selector).first
            candidate.wait_for(state="visible", timeout=1200)
            return candidate
        except Exception:
            continue
    return None


def _select_search_input(page: Any):
    search_root = _locate_search_root(page)
    if search_root is not None:
        for selector in _SEARCH_INPUT_SELECTORS:
            try:
                candidate = search_root.locator(selector).first
                candidate.wait_for(state="visible", timeout=1200)
                return candidate
            except Exception:
                continue

    for selector in _SEARCH_INPUT_SELECTORS:
        try:
            candidate = page.locator(selector).first
            candidate.wait_for(state="visible", timeout=1200)
            return candidate
        except Exception:
            continue

    _activate_search_panel(page)

    search_root = _locate_search_root(page)
    if search_root is not None:
        for selector in _SEARCH_INPUT_SELECTORS:
            try:
                candidate = search_root.locator(selector).first
                candidate.wait_for(state="visible", timeout=1000)
                return candidate
            except Exception:
                continue
    raise RuntimeError("ThreatBook search input was not found.")


def _open_threat_intel_result(page: Any, target_url: str, timeout_ms: int) -> list[str]:
    warnings: list[str] = []
    fast_timeout_ms = max(500, min(timeout_ms, 1200))

    search_root = _locate_search_root(page)
    if search_root is not None:
        try:
            search_root.locator("textarea.x-searchBar-input").first.focus(timeout=fast_timeout_ms)
        except Exception:
            pass

    warnings.append("ThreatBook direct Enter search was used.")
    page.keyboard.press("Enter")
    return warnings


def _labels_from_structured_result(parsed: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    header = parsed.get("header") or {}
    verdict = _map_text_verdict(header.get("verdict_text"))
    if verdict:
        labels.append(verdict)
    for tag in header.get("tags") or []:
        label = _make_tag_label(str(tag))
        if label not in labels:
            labels.append(label)
    if (parsed.get("intel_insight") or {}).get("suspicious_feature_count"):
        labels.append("intel_insight_present")
    report = parsed.get("url_report") or {}
    intelligence = report.get("intelligence") or {}
    report_verdict = _map_text_verdict(intelligence.get("verdict_text"))
    if report_verdict and report_verdict not in labels:
        labels.append(report_verdict)
    for value in intelligence.get("intel_contents") or []:
        label = _make_tag_label(str(value))
        if label not in labels:
            labels.append(label)
    phishing_model = report.get("phishing_model") or {}
    model_verdict = _clean_structured_value(phishing_model.get("model_verdict"))
    if model_verdict:
        labels.append(f"phishing_model:{model_verdict}")
    http_response = report.get("http_response") or {}
    if http_response.get("status_code") is not None:
        labels.append(f"http_status:{http_response.get('status_code')}")
    return labels


def _resolve_structured_verdict(
    parsed: dict[str, Any],
    target_url: str,
    body_text: str,
    warnings: list[str],
) -> tuple[str, list[str], str | None, dict[str, Any]]:
    header = parsed.get("header") or {}
    resource = header.get("resource")
    verdict_text = header.get("verdict_text")
    structured_verdict = _map_text_verdict(verdict_text)
    resource_matches = _resource_matches_query(resource, target_url)
    report = parsed.get("url_report") or {}
    intelligence = report.get("intelligence") or {}
    report_resource = intelligence.get("resource")
    report_verdict_text = intelligence.get("verdict_text")
    report_verdict = _map_text_verdict(report_verdict_text)
    report_resource_matches = _resource_matches_query(report_resource, target_url)
    phishing_model = report.get("phishing_model") or {}
    model_verdict = _clean_structured_value(phishing_model.get("model_verdict"))
    last_sample = report.get("last_sample") or {}

    safe_signals: list[str] = []
    danger_signals: list[str] = []
    unknown_signals: list[str] = []

    def add_signal(kind: str, reason: str) -> None:
        bucket = {
            "safe": safe_signals,
            "danger": danger_signals,
            "unknown": unknown_signals,
        }[kind]
        if reason not in bucket:
            bucket.append(reason)

    if structured_verdict == "benign" and resource_matches:
        add_signal("safe", "summary_card_verdict")
    elif structured_verdict in {"malicious", "suspicious"} and resource_matches:
        add_signal("danger", "summary_card_verdict")
    elif structured_verdict == "unknown" and resource_matches:
        add_signal("unknown", "summary_card_verdict")

    if report_resource_matches:
        if report_verdict == "benign":
            add_signal("safe", "url_report_intelligence")
        elif report_verdict in {"malicious", "suspicious"}:
            add_signal("danger", "url_report_intelligence")
        elif report_verdict == "unknown":
            add_signal("unknown", "url_report_intelligence")

    intel_contents = intelligence.get("intel_contents") or []
    if any("白名单" in str(value) for value in intel_contents):
        add_signal("safe", "intelligence_whitelist")
    if any(any(term in str(value) for term in ("恶意", "钓鱼", "欺诈", "高危", "危险")) for value in intel_contents):
        add_signal("danger", "intelligence_danger_tag")

    header_tags = header.get("tags") or []
    if any(any(term in str(value) for term in ("恶意", "钓鱼", "欺诈", "高危", "远控", "黑产")) for value in header_tags):
        add_signal("danger", "summary_card_tag")

    if model_verdict:
        mapped_model = _map_text_verdict(model_verdict)
        if mapped_model == "benign":
            add_signal("safe", "phishing_model")
        elif mapped_model in {"malicious", "suspicious"}:
            add_signal("danger", "phishing_model")
        elif mapped_model == "unknown":
            add_signal("unknown", "phishing_model")

    last_sample_result = _clean_structured_value(last_sample.get("result_text"))
    if _map_text_verdict(last_sample_result) == "unknown":
        add_signal("unknown", "last_sample_result")

    decision_basis = {
        "resource": resource,
        "verdict_text": verdict_text,
        "structured_verdict": structured_verdict,
        "resource_matches_query": resource_matches,
        "report_resource": report_resource,
        "report_verdict_text": report_verdict_text,
        "report_verdict": report_verdict,
        "report_resource_matches_query": report_resource_matches,
        "safe_signals": safe_signals,
        "danger_signals": danger_signals,
        "unknown_signals": unknown_signals,
    }

    labels = _labels_from_structured_result(parsed)
    labels.extend(label for label in _extract_page_risk_terms(body_text) if label not in labels)

    if safe_signals and danger_signals:
        decision_basis["mode"] = "conflicting_signals"
        warnings.append("ThreatBook reported both safe and dangerous signals; downgraded to unknown.")
        summary = _build_url_report_summary(parsed) or _build_structured_summary(parsed) or "ThreatBook存在安全与危险信号冲突，当前按未知处理。"
        return "unknown", labels, summary, decision_basis

    if safe_signals:
        decision_basis["mode"] = "safe_signals"
        summary = _build_url_report_summary(parsed) or _build_structured_summary(parsed)
        return "benign", labels, summary, decision_basis

    if danger_signals:
        decision_basis["mode"] = "danger_signals"
        summary = _build_url_report_summary(parsed) or _build_structured_summary(parsed)
        return "malicious", labels, summary, decision_basis

    if unknown_signals:
        decision_basis["mode"] = "unknown_signals"
        warnings.append("ThreatBook only returned unknown signals; treated as unknown.")
        summary = _build_url_report_summary(parsed) or "ThreatBook结果页仅返回未知信号，当前按未知处理。"
        return "unknown", labels, summary, decision_basis

    if not resource:
        warnings.append("ThreatBook structured verdict missing resource; downgraded to unknown.")
        labels.append("no_structured_resource")
    elif not resource_matches:
        warnings.append("ThreatBook structured resource does not match the queried URL; downgraded to unknown.")
        labels.append("structured_resource_mismatch")
    if not structured_verdict:
        warnings.append("ThreatBook structured verdict text was unavailable; downgraded to unknown.")
        labels.append("no_structured_verdict")
    if report_resource and not report_resource_matches:
        warnings.append("ThreatBook URL report resource does not match the queried URL; downgraded to unknown.")
        labels.append("url_report_resource_mismatch")
    if not report_verdict:
        labels.append("no_url_report_verdict")

    decision_basis["mode"] = "fallback_unknown"
    summary = _build_url_report_summary(parsed) or (
        "ThreatBook结果页未提取到与查询目标一致且可靠的主卡片判定，当前按未知处理。"
    )
    return "unknown", labels, summary, decision_basis


def _lookup_url_with_threatbook_sync(target_url: str) -> ThreatBookLookupResult:
    if not settings.threatbook_lookup_enabled:
        return ThreatBookLookupResult(
            provider="threatbook",
            status="skipped",
            verdict=None,
            summary="ThreatBook lookup is disabled.",
            labels=[],
            warnings=[],
            raw={},
        )

    sync_playwright, PlaywrightTimeoutError = _load_playwright()
    timeout_ms = max(5000, int(settings.threatbook_lookup_timeout_ms))
    keep_open = bool(settings.threatbook_lookup_keep_open and not settings.threatbook_lookup_headless)
    warnings: list[str] = []
    raw: dict[str, Any] = {"entry_url": THREATBOOK_ENTRY_URL, "query_url": target_url, "steps": []}
    storage_state_path = _storage_state_path()
    raw["storage_state_path"] = str(storage_state_path)

    playwright_manager = sync_playwright()
    playwright = playwright_manager.start()
    browser = None
    context = None
    page = None

    try:
        browser = playwright.chromium.launch(**_build_launch_kwargs())
        context_kwargs: dict[str, Any] = {
            "user_agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/135.0.0.0 Safari/537.36"
            ),
            "locale": "zh-CN",
            "viewport": {"width": 1440, "height": 960},
        }
        if storage_state_path.is_file():
            context_kwargs["storage_state"] = str(storage_state_path)
        context = browser.new_context(**context_kwargs)
        raw["storage_state_loaded"] = storage_state_path.is_file()
        page = context.new_page()
        page.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
            });
            """
        )

        page.goto(THREATBOOK_ENTRY_URL, wait_until="domcontentloaded", timeout=min(timeout_ms, 10000))
        raw["steps"].append("homepage_loaded")

        warnings.extend(_dismiss_threatbook_popups(page, timeout_ms))
        raw["steps"].append("popups_dismissed")

        search_input = _select_search_input(page)
        raw["steps"].append("search_input_found")
        search_input.click(timeout=2000)
        try:
            search_input.fill(target_url, timeout=2500)
        except Exception:
            try:
                search_input.press("Control+A")
                search_input.type(target_url, delay=15)
            except Exception:
                page.keyboard.press("Control+A")
                page.keyboard.type(target_url, delay=15)
        raw["steps"].append("query_filled")

        page.wait_for_timeout(800)
        warnings.extend(_open_threat_intel_result(page, target_url, timeout_ms))
        raw["steps"].append("result_triggered")

        try:
            page.wait_for_url(lambda url: str(url).strip() != THREATBOOK_ENTRY_URL, timeout=min(timeout_ms, 8000))
            raw["steps"].append("url_changed")
        except PlaywrightTimeoutError:
            warnings.append("ThreatBook result page did not change URL in time; parsing current page.")

        warnings.extend(_dismiss_threatbook_popups(page, timeout_ms))
        page.wait_for_timeout(1200)
        warnings.extend(_wait_for_final_report(page, timeout_ms))
        raw["steps"].append("result_page_ready")
        raw["steps"].append("final_report_waited")

        body_text = _normalize_whitespace(page.locator("body").inner_text(timeout=min(timeout_ms, 8000)))
        raw["result_page_url"] = page.url
        raw["body_excerpt"] = body_text[:4000]
        parsed_result: dict[str, Any] = {}
        try:
            parsed_result = _extract_structured_result(page, timeout_ms)
            raw["parsed"] = parsed_result
            raw["parsed_excerpt"] = json.dumps(parsed_result, ensure_ascii=False)[:4000]
            raw["steps"].append("structured_result_parsed")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"ThreatBook structured parsing fallback: {type(exc).__name__}: {exc}")

        verdict, labels, summary, decision_basis = _resolve_structured_verdict(
            parsed_result,
            target_url,
            body_text,
            warnings,
        )
        raw["decision_basis"] = decision_basis
        if not summary:
            summary = _extract_summary(body_text, target_url) or "ThreatBook returned no reliable structured verdict."

        return ThreatBookLookupResult(
            provider="threatbook",
            status="completed",
            verdict=verdict,
            summary=summary,
            labels=labels,
            warnings=warnings,
            raw=raw,
        )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ThreatBook lookup failed: {type(exc).__name__}: {exc}")
        return ThreatBookLookupResult(
            provider="threatbook",
            status="failed",
            verdict=None,
            summary=None,
            labels=[],
            warnings=warnings,
            raw=raw,
        )
    finally:
        if context is not None:
            _save_storage_state(context, raw, warnings)
        if context is not None and keep_open:
            _DEBUG_BROWSER_SESSIONS.append(
                {
                    "playwright": playwright,
                    "browser": browser,
                    "context": context,
                    "page": page,
                }
            )
        else:
            if page is not None:
                _safe_close(page)
            if context is not None:
                _safe_close(context)
            if browser is not None:
                _safe_close(browser)
            try:
                playwright.stop()
            except Exception:
                pass


def lookup_url_with_threatbook(target_url: str) -> ThreatBookLookupResult:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        script_path = _subprocess_script_path()
        try:
            completed = subprocess.run(
                [sys.executable, str(script_path), target_url],
                capture_output=True,
                text=True,
                timeout=max(30, int(settings.threatbook_lookup_timeout_ms / 1000) + 15),
                check=False,
            )
        except Exception as exc:  # noqa: BLE001
            return ThreatBookLookupResult(
                provider="threatbook",
                status="failed",
                verdict=None,
                summary=None,
                labels=[],
                warnings=[f"ThreatBook subprocess launch failed: {type(exc).__name__}: {exc}"],
                raw={"query_url": target_url},
            )

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            return ThreatBookLookupResult(
                provider="threatbook",
                status="failed",
                verdict=None,
                summary=None,
                labels=[],
                warnings=[
                    "ThreatBook subprocess returned a non-zero exit code.",
                    stderr or stdout or f"exit_code={completed.returncode}",
                ],
                raw={"query_url": target_url},
            )

        try:
            payload = json.loads((completed.stdout or "").strip())
            return ThreatBookLookupResult(
                provider=str(payload.get("provider") or "threatbook"),
                status=str(payload.get("status") or "failed"),
                verdict=payload.get("verdict"),
                summary=payload.get("summary"),
                labels=list(payload.get("labels") or []),
                warnings=list(payload.get("warnings") or []),
                raw=dict(payload.get("raw") or {}),
            )
        except Exception as exc:  # noqa: BLE001
            return ThreatBookLookupResult(
                provider="threatbook",
                status="failed",
                verdict=None,
                summary=None,
                labels=[],
                warnings=[
                    f"ThreatBook subprocess JSON parse failed: {type(exc).__name__}: {exc}",
                    (completed.stdout or "").strip()[:1000],
                ],
                raw={"query_url": target_url},
            )
    return _lookup_url_with_threatbook_sync(target_url)
