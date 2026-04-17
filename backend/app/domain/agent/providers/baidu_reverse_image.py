from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import sys
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlparse

from app.shared.core.config import settings


BAIDU_ENTRY_URL = "https://graph.baidu.com/pcpage/index?tpl_from=pc"
FIRST_URL_PATTERNS = (
    re.compile(r'"firstUrl"\s*:\s*"([^"]+)"'),
    re.compile(r"firstUrl\\?\":\\?\"([^\"]+)"),
)
_DEBUG_BROWSER_SESSIONS: list[dict[str, Any]] = []


@dataclass(slots=True)
class ReverseImageProviderResult:
    provider: str
    status: str
    matches: list[dict[str, Any]]
    warnings: list[str]
    raw: dict[str, Any]


def _domain(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    return parsed.netloc.lower() or None


def _replace_escaped(value: str) -> str:
    return value.replace("\\/", "/").replace("\\u0026", "&")


def _extract_first_url(html: str, base_url: str) -> str | None:
    for pattern in FIRST_URL_PATTERNS:
        match = pattern.search(html)
        if match:
            raw = _replace_escaped(match.group(1))
            return urljoin(base_url, raw)
    return None


def _normalize_baidu_list(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, dict):
        return []

    items = data.get("list")
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        source_url = (
            item.get("fromUrl")
            or item.get("from_url")
            or item.get("pageUrl")
            or item.get("url")
        )
        image_url = (
            item.get("imageUrl")
            or item.get("objUrl")
            or item.get("detail_url")
            or item.get("origin")
        )
        thumb_url = item.get("thumbUrl") or item.get("thumbnailUrl") or item.get("thumb_url")
        title = item.get("title") or item.get("brief") or item.get("fromTitle") or ""
        normalized.append(
            {
                "thumbnail_url": thumb_url,
                "image_url": image_url,
                "source_url": source_url,
                "title": title,
                "domain": _domain(str(source_url) if source_url else None),
                "provider": "baidu",
                "match_type": "unknown",
                "raw": item,
            }
        )
    return normalized


def _request_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/135.0.0.0 Safari/537.36"
        ),
        "Referer": BAIDU_ENTRY_URL,
        "Origin": "https://graph.baidu.com",
    }


def _guess_mime_type(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "image/png"


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
        "headless": settings.reverse_image_browser_headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--lang=zh-CN",
        ],
    }
    executable_path = (settings.reverse_image_browser_executable_path or "").strip()
    if executable_path:
        launch_kwargs["executable_path"] = executable_path
    return launch_kwargs


def _extract_json_matches_from_response(response: Any) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        return [], None
    if not isinstance(payload, dict):
        return [], None
    matches = _normalize_baidu_list(payload)
    return matches, payload


def search_baidu_reverse_image(image_bytes: bytes, filename: str = "upload.png") -> ReverseImageProviderResult:
    sync_playwright, PlaywrightTimeoutError = _load_playwright()
    timeout_ms = max(5000, int(settings.reverse_image_browser_timeout_ms))
    warnings: list[str] = []
    raw: dict[str, Any] = {"engine": "playwright_chromium"}
    keep_open = bool(settings.reverse_image_browser_keep_open and not settings.reverse_image_browser_headless)
    playwright_manager = sync_playwright()
    playwright = playwright_manager.start()
    browser = None
    context = None
    page = None

    try:
        browser = playwright.chromium.launch(**_build_launch_kwargs())
        context = browser.new_context(
            user_agent=_request_headers()["User-Agent"],
            locale="zh-CN",
            viewport={"width": 1440, "height": 960},
            extra_http_headers=_request_headers(),
        )
        page = context.new_page()
        page.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
            });
            """
        )

        ajax_payloads: list[dict[str, Any]] = []

        def _capture_response(response: Any) -> None:
            if "graph.baidu.com/ajax/" not in response.url:
                return
            matches, payload = _extract_json_matches_from_response(response)
            if matches and payload is not None:
                ajax_payloads.append(
                    {
                        "url": response.url,
                        "payload": payload,
                        "matches": matches,
                    }
                )

        page.on("response", _capture_response)

        page.goto(BAIDU_ENTRY_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        try:
            page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 10000))
        except PlaywrightTimeoutError:
            warnings.append("Baidu entry page did not reach networkidle before upload; continuing.")

        file_input = page.locator("input[type='file']").first
        file_input.wait_for(state="attached", timeout=timeout_ms)

        upload_file = {
            "name": filename,
            "mimeType": _guess_mime_type(filename),
            "buffer": image_bytes,
        }

        with page.expect_response(
            lambda response: "graph.baidu.com/upload" in response.url
            and response.request.method.upper() == "POST",
            timeout=timeout_ms,
        ) as upload_info:
            file_input.set_input_files(upload_file)

        upload_response = upload_info.value
        raw["upload_response_url"] = upload_response.url
        upload_json: dict[str, Any] | None = None
        try:
            parsed_upload = upload_response.json()
            if isinstance(parsed_upload, dict):
                upload_json = parsed_upload
                raw["upload"] = upload_json
        except Exception as exc:  # noqa: BLE001
            raw["upload_body_error"] = str(exc)
            warnings.append("Could not read Baidu upload response body from Playwright; falling back to page navigation state.")

        if upload_json and upload_json.get("msg") not in {None, "Success"}:
            return ReverseImageProviderResult(
                provider="baidu",
                status="failed",
                matches=[],
                warnings=[
                    "Baidu upload was rejected in the browser context as well.",
                    *warnings,
                ],
                raw=raw,
            )

        try:
            page.wait_for_url(lambda url: "graph.baidu.com/s" in url, timeout=min(timeout_ms, 15000))
        except PlaywrightTimeoutError:
            warnings.append("The browser did not navigate to a Baidu result page within the expected time.")

        result_page_url = str((upload_json or {}).get("data", {}).get("url") or page.url or "").strip()
        raw["result_page_url"] = result_page_url
        if not result_page_url:
            return ReverseImageProviderResult(
                provider="baidu",
                status="failed",
                matches=[],
                warnings=["Baidu upload did not include a result page URL.", *warnings],
                raw=raw,
            )

        page.goto(result_page_url, wait_until="domcontentloaded", timeout=timeout_ms)

        ajax_response = None
        try:
            ajax_response = page.wait_for_event(
                "response",
                lambda response: "graph.baidu.com/ajax/" in response.url,
                timeout=min(timeout_ms, 12000),
            )
        except PlaywrightTimeoutError:
            warnings.append("No Baidu ajax result response was captured automatically; falling back to page parsing.")

        if ajax_response is not None:
            matches, payload = _extract_json_matches_from_response(ajax_response)
            if matches:
                raw["ajax_match_url"] = ajax_response.url
                raw["ajax_match_payload"] = payload
                return ReverseImageProviderResult(
                    provider="baidu",
                    status="completed",
                    matches=matches,
                    warnings=warnings,
                    raw=raw,
                )

        if ajax_payloads:
            raw["ajax_match_url"] = ajax_payloads[0]["url"]
            raw["ajax_match_payload"] = ajax_payloads[0]["payload"]
            return ReverseImageProviderResult(
                provider="baidu",
                status="completed",
                matches=ajax_payloads[0]["matches"],
                warnings=warnings,
                raw=raw,
            )

        html = page.content()
        first_url = _extract_first_url(html, result_page_url)
        raw["first_url"] = first_url
        if not first_url:
            return ReverseImageProviderResult(
                provider="baidu",
                status="partial",
                matches=[],
                warnings=["Unable to extract firstUrl from the Baidu result page.", *warnings],
                raw={**raw, "result_page_excerpt": html[:2000]},
            )

        data_page = context.new_page()
        try:
            data_response = data_page.goto(first_url, wait_until="domcontentloaded", timeout=timeout_ms)
            if data_response is None:
                return ReverseImageProviderResult(
                    provider="baidu",
                    status="partial",
                    matches=[],
                    warnings=["Baidu firstUrl navigation returned no response object.", *warnings],
                    raw=raw,
                )
            text_payload = data_response.text()
        finally:
            data_page.close()

        try:
            data_json = json.loads(text_payload)
        except json.JSONDecodeError:
            return ReverseImageProviderResult(
                provider="baidu",
                status="partial",
                matches=[],
                warnings=["Baidu firstUrl did not return JSON.", *warnings],
                raw={**raw, "first_url_response_text": text_payload[:2000]},
            )

        raw["first_payload"] = data_json
        matches = _normalize_baidu_list(data_json)
        if not matches:
            warnings.append("Baidu browser provider returned no structured matches.")

        return ReverseImageProviderResult(
            provider="baidu",
            status="completed" if matches else "partial",
            matches=matches,
            warnings=warnings,
            raw=raw,
        )
    finally:
        if keep_open and browser is not None and context is not None:
            raw["debug_browser_kept_open"] = True
            _DEBUG_BROWSER_SESSIONS.append(
                {
                    "manager": playwright_manager,
                    "browser": browser,
                    "context": context,
                    "page": page,
                }
            )
        else:
            if context is not None:
                _safe_close(context)
            if browser is not None:
                _safe_close(browser)
            try:
                playwright_manager.stop()
            except Exception:
                pass
