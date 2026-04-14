"""检测 LLM 调用。"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.shared.core.config import settings


@dataclass(slots=True)
class ChatJsonResult:
    model_name: str
    payload: dict[str, Any]
    raw_content: str


class ChatJsonClient:
    def complete_json(self, *, system_prompt: str, user_prompt: str) -> ChatJsonResult:
        raise NotImplementedError


class OpenAICompatibleChatJsonClient(ChatJsonClient):
    def __init__(
        self,
        *,
        api_url: str,
        api_key: str,
        model_name: str,
        timeout_seconds: int,
        temperature: float,
        max_tokens: int,
        enable_thinking: bool,
    ) -> None:
        self._api_url = api_url
        self._api_key = api_key
        self._model_name = model_name
        self._timeout_seconds = timeout_seconds
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._enable_thinking = enable_thinking

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> ChatJsonResult:
        payload = {
            "model": self._model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
            "stream": False,
            "enable_thinking": self._enable_thinking,
        }
        request = urllib.request.Request(
            self._api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LLM request failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc.reason}") from exc

        data = json.loads(body)
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("LLM response did not include choices")
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            raw_content = "".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in content
            )
        else:
            raw_content = str(content or "")

        json_payload = _extract_json_payload(raw_content)
        return ChatJsonResult(
            model_name=self._model_name,
            payload=json_payload,
            raw_content=raw_content,
        )


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json_payload(raw_content: str) -> dict[str, Any]:
    text = raw_content.strip()
    if not text:
        raise RuntimeError("LLM returned empty content")
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    match = _JSON_BLOCK_RE.search(text)
    if match is None:
        raise RuntimeError("LLM content did not contain JSON")
    payload = json.loads(match.group(0))
    if not isinstance(payload, dict):
        raise RuntimeError("LLM JSON content must be an object")
    return payload


def build_chat_json_client() -> ChatJsonClient:
    provider = settings.detection_llm_provider.strip().lower()
    if provider != "openai_compatible":
        raise RuntimeError(f"Unsupported detection llm provider: {settings.detection_llm_provider}")

    api_key = (settings.detection_llm_api_key or settings.rag_embedding_api_key or "").strip()
    if not api_key:
        raise RuntimeError("DETECTION_LLM_API_KEY is required for openai_compatible detection llm")

    return OpenAICompatibleChatJsonClient(
        api_url=settings.detection_llm_api_url,
        api_key=api_key,
        model_name=settings.detection_llm_model,
        timeout_seconds=settings.detection_llm_timeout_seconds,
        temperature=settings.detection_llm_temperature,
        max_tokens=settings.detection_llm_max_tokens,
        enable_thinking=settings.detection_llm_enable_thinking,
    )
