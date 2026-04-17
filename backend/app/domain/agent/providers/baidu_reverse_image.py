from __future__ import annotations

import json
import mimetypes
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.shared.core.config import settings


BAIDU_BASE_URL = "https://graph.baidu.com"
BAIDU_UPLOAD_URL = f"{BAIDU_BASE_URL}/upload"
BAIDU_ENTRY_URL = f"{BAIDU_BASE_URL}/pcpage/index?tpl_from=pc"
FIRST_URL_PATTERNS = (
    re.compile(r'"firstUrl"\s*:\s*"([^"]+)"'),
    re.compile(r"firstUrl\\?\":\\?\"([^\"]+)"),
)


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


def _guess_mime_type(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "image/png"


def _request_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/135.0.0.0 Safari/537.36"
        ),
        "Referer": BAIDU_ENTRY_URL,
        "Origin": BAIDU_BASE_URL,
    }


def _extract_first_url(html: str, base_url: str) -> str | None:
    for pattern in FIRST_URL_PATTERNS:
        match = pattern.search(html)
        if match:
            raw = _replace_escaped(match.group(1))
            return urljoin(base_url, raw)
    return None


def _extract_js_array_literal(source: str, marker: str) -> str | None:
    start_marker = source.find(marker)
    if start_marker < 0:
        return None

    bracket_start = source.find("[", start_marker)
    if bracket_start < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    for index in range(bracket_start, len(source)):
        char = source[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return source[bracket_start : index + 1]
    return None


def _extract_card_data(html: str) -> list[dict[str, Any]]:
    literal = _extract_js_array_literal(html, "window.cardData")
    if not literal:
        return []
    try:
        payload = json.loads(literal)
    except json.JSONDecodeError:
        return []
    return [item for item in payload if isinstance(item, dict)]


def _normalize_baidu_items(items: list[dict[str, Any]], *, match_type: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in items:
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
            or item.get("image_src")
        )
        thumb_url = (
            item.get("thumbUrl")
            or item.get("thumbnailUrl")
            or item.get("thumb_url")
            or item.get("image_src")
        )
        title = item.get("title") or item.get("brief") or item.get("fromTitle") or ""
        normalized.append(
            {
                "thumbnail_url": thumb_url,
                "image_url": image_url,
                "source_url": source_url,
                "title": title,
                "domain": _domain(str(source_url) if source_url else None),
                "provider": "baidu",
                "match_type": match_type,
                "raw": item,
            }
        )
    return normalized


def _normalize_baidu_payload(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    exact_matches: list[dict[str, Any]] = []
    similar_matches: list[dict[str, Any]] = []

    same_data = payload.get("same")
    if isinstance(same_data, dict):
        same_list = same_data.get("list")
        if isinstance(same_list, list):
            exact_matches = _normalize_baidu_items(
                [item for item in same_list if isinstance(item, dict)],
                match_type="exact",
            )

    data = payload.get("data")
    if isinstance(data, dict):
        items = data.get("list")
        if isinstance(items, list):
            similar_matches = _normalize_baidu_items(
                [item for item in items if isinstance(item, dict)],
                match_type="similar",
            )

    return exact_matches, similar_matches


def search_baidu_reverse_image(image_bytes: bytes, filename: str = "upload.png") -> ReverseImageProviderResult:
    timeout = max(5.0, float(settings.reverse_image_timeout_seconds))
    warnings: list[str] = []
    raw: dict[str, Any] = {"engine": "http_card_data"}
    headers = _request_headers()
    files = {"image": (filename, image_bytes, _guess_mime_type(filename))}

    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        upload_response = client.post(
            BAIDU_UPLOAD_URL,
            data={"from": "pc"},
            files=files,
            headers={"Acs-Token": "", **headers},
        )
        upload_response.raise_for_status()
        raw["upload_response_url"] = str(upload_response.url)

        try:
            upload_json = upload_response.json()
        except Exception as exc:  # noqa: BLE001
            return ReverseImageProviderResult(
                provider="baidu",
                status="failed",
                matches=[],
                warnings=[f"Baidu upload did not return JSON: {type(exc).__name__}: {exc}"],
                raw=raw,
            )

        if not isinstance(upload_json, dict):
            return ReverseImageProviderResult(
                provider="baidu",
                status="failed",
                matches=[],
                warnings=["Baidu upload returned an unexpected payload type."],
                raw=raw,
            )

        raw["upload"] = upload_json
        upload_data = upload_json.get("data") if isinstance(upload_json.get("data"), dict) else {}
        result_page_url = str(upload_data.get("url") or "").strip()
        raw["result_page_url"] = result_page_url
        if not result_page_url:
            return ReverseImageProviderResult(
                provider="baidu",
                status="failed",
                matches=[],
                warnings=["Baidu upload did not include a result page URL."],
                raw=raw,
            )

        result_page_response = client.get(result_page_url)
        result_page_response.raise_for_status()
        result_page_html = result_page_response.text
        raw["result_page_status_code"] = result_page_response.status_code

        card_data = _extract_card_data(result_page_html)
        raw["card_data_count"] = len(card_data)
        raw["card_names"] = [str(card.get("cardName") or "") for card in card_data]

        same_data = None
        first_url = None
        no_result = False
        for card in card_data:
            card_name = str(card.get("cardName") or "")
            tpl_data = card.get("tplData") if isinstance(card.get("tplData"), dict) else {}
            if card_name == "noresult":
                no_result = True
                break
            if card_name == "same":
                same_data = tpl_data
            if card_name == "simipic" and not first_url:
                first_url = str(tpl_data.get("firstUrl") or "").strip() or None

        if no_result:
            return ReverseImageProviderResult(
                provider="baidu",
                status="completed",
                matches=[],
                warnings=warnings,
                raw=raw,
            )

        if not first_url:
            first_url = _extract_first_url(result_page_html, result_page_url)
            if first_url:
                warnings.append("window.cardData did not expose simipic.firstUrl directly; used HTML fallback.")
        raw["first_url"] = first_url
        if not first_url:
            return ReverseImageProviderResult(
                provider="baidu",
                status="partial",
                matches=[],
                warnings=["Unable to extract simipic.firstUrl from the Baidu result page.", *warnings],
                raw={**raw, "result_page_excerpt": result_page_html[:2000]},
            )

        first_response = client.get(first_url)
        first_response.raise_for_status()
        raw["first_url_status_code"] = first_response.status_code
        raw["first_url_response_url"] = str(first_response.url)

        try:
            first_payload = first_response.json()
        except Exception as exc:  # noqa: BLE001
            return ReverseImageProviderResult(
                provider="baidu",
                status="partial",
                matches=[],
                warnings=[f"Baidu firstUrl did not return JSON: {type(exc).__name__}: {exc}", *warnings],
                raw={**raw, "first_url_response_text": first_response.text[:2000]},
            )

        if not isinstance(first_payload, dict):
            return ReverseImageProviderResult(
                provider="baidu",
                status="partial",
                matches=[],
                warnings=["Baidu firstUrl returned an unexpected payload type.", *warnings],
                raw=raw,
            )

        if same_data:
            first_payload["same"] = same_data

        raw["first_payload"] = first_payload
        exact_matches, similar_matches = _normalize_baidu_payload(first_payload)
        matches = [*exact_matches, *similar_matches]
        raw["exact_match_count"] = len(exact_matches)
        raw["similar_match_count"] = len(similar_matches)

        if not matches:
            warnings.append("Baidu provider returned no structured matches after parsing same/simipic payloads.")

        return ReverseImageProviderResult(
            provider="baidu",
            status="completed" if matches else "partial",
            matches=matches,
            warnings=warnings,
            raw=raw,
        )
