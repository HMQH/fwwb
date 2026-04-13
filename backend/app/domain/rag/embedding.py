"""Embedding providers for the RAG ingestion pipeline."""
from __future__ import annotations

import hashlib
import json
import math
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.shared.core.config import settings


@dataclass(slots=True)
class EmbeddingResult:
    model_name: str
    dimensions: int
    vectors: list[list[float]]


class EmbeddingClient:
    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        raise NotImplementedError


class HashEmbeddingClient(EmbeddingClient):
    """Deterministic dev embedding provider that keeps the pipeline runnable."""

    def __init__(self, *, model_name: str, dimensions: int) -> None:
        self._model_name = model_name
        self._dimensions = dimensions

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self._dimensions
        if not text:
            vector[0] = 1.0
            return vector

        normalized = text.strip()
        window = 3 if len(normalized) >= 3 else 1
        token_count = max(1, len(normalized) - window + 1)
        for i in range(token_count):
            token = normalized[i : i + window]
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=16).digest()
            index = int.from_bytes(digest[:4], "big") % self._dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            magnitude = 0.5 + (digest[5] / 255.0)
            vector[index] += sign * magnitude

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            vector[0] = 1.0
            return vector
        return [value / norm for value in vector]

    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        return EmbeddingResult(
            model_name=self._model_name,
            dimensions=self._dimensions,
            vectors=[self._embed_one(text) for text in texts],
        )


class OpenAICompatibleEmbeddingClient(EmbeddingClient):
    def __init__(
        self,
        *,
        api_url: str,
        api_key: str,
        model_name: str,
        dimensions: int,
        timeout_seconds: int,
    ) -> None:
        self._api_url = api_url
        self._api_key = api_key
        self._model_name = model_name
        self._dimensions = dimensions
        self._timeout_seconds = timeout_seconds

    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        payload = {
            "model": self._model_name,
            "input": texts,
            "dimensions": self._dimensions,
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
            raise RuntimeError(f"Embedding request failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Embedding request failed: {exc.reason}") from exc

        data = json.loads(body)
        items = data.get("data")
        if not isinstance(items, list):
            raise RuntimeError("Embedding response did not include a data array")

        vectors: list[list[float]] = []
        for item in items:
            vector = item.get("embedding")
            if not isinstance(vector, list):
                raise RuntimeError("Embedding item did not include an embedding vector")
            vectors.append([float(value) for value in vector])

        if any(len(vector) != self._dimensions for vector in vectors):
            raise RuntimeError("Embedding response dimension mismatch")

        return EmbeddingResult(
            model_name=self._model_name,
            dimensions=self._dimensions,
            vectors=vectors,
        )


def build_embedding_client() -> EmbeddingClient:
    provider = settings.rag_embedding_provider.strip().lower()
    if provider == "hash":
        return HashEmbeddingClient(
            model_name=settings.rag_embedding_model,
            dimensions=settings.rag_embedding_dimensions,
        )
    if provider == "openai_compatible":
        api_key = (settings.rag_embedding_api_key or "").strip()
        if not api_key:
            raise RuntimeError("RAG_EMBEDDING_API_KEY is required for openai_compatible embeddings")
        return OpenAICompatibleEmbeddingClient(
            api_url=settings.rag_embedding_api_url,
            api_key=api_key,
            model_name=settings.rag_embedding_model,
            dimensions=settings.rag_embedding_dimensions,
            timeout_seconds=settings.rag_embedding_timeout_seconds,
        )
    raise RuntimeError(f"Unsupported embedding provider: {settings.rag_embedding_provider}")

