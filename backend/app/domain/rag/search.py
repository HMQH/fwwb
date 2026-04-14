"""RAG 查询服务层：文本检测时从向量库召回黑白样本。"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from app.domain.rag import repository
from app.domain.rag.embedding import build_embedding_client
from app.shared.core.config import settings


@dataclass(slots=True)
class ComparativeSearchResult:
    query_text: str
    keywords: list[str]
    black_hits: list[repository.TextChunkSearchHit]
    white_hits: list[repository.TextChunkSearchHit]

    def to_json(self) -> dict:
        return {
            "query_text": self.query_text,
            "keywords": self.keywords,
            "black_hits": [asdict(hit) for hit in self.black_hits],
            "white_hits": [asdict(hit) for hit in self.white_hits],
        }


def _serialize_vector(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _merge_hits(
    *,
    vector_hits: list[repository.TextChunkSearchHit],
    keyword_hits: list[repository.TextChunkSearchHit],
    limit: int,
) -> list[repository.TextChunkSearchHit]:
    merged: dict[tuple[int, int, str], repository.TextChunkSearchHit] = {}

    def upsert(hit: repository.TextChunkSearchHit) -> None:
        key = (hit.source_id, hit.chunk_index, hit.sample_label)
        current = merged.get(key)
        if current is None:
            merged[key] = repository.TextChunkSearchHit(
                source_id=hit.source_id,
                chunk_index=hit.chunk_index,
                chunk_text=hit.chunk_text,
                sample_label=hit.sample_label,
                fraud_type=hit.fraud_type,
                data_source=hit.data_source,
                url=hit.url,
                content_hash=hit.content_hash,
                embedding_model=hit.embedding_model,
                score=hit.score,
                match_source=hit.match_source,
                extra_meta=hit.extra_meta,
            )
            return

        current.score = max(current.score, hit.score)
        if current.match_source != hit.match_source:
            current.match_source = "hybrid"
            current.score += 0.12

    for item in vector_hits:
        upsert(item)
    for item in keyword_hits:
        upsert(item)

    return sorted(merged.values(), key=lambda item: item.score, reverse=True)[:limit]


def _embed_query_text(query_text: str) -> str | None:
    normalized = query_text.strip()
    if not normalized:
        return None
    client = build_embedding_client()
    result = client.embed_texts([normalized])
    if not result.vectors:
        return None
    return _serialize_vector(result.vectors[0])


def search_comparative_text(
    db: Session,
    *,
    query_text: str,
    keywords: list[str] | None = None,
    black_top_k: int | None = None,
    white_top_k: int | None = None,
    vector_top_k: int | None = None,
    keyword_top_k: int | None = None,
) -> ComparativeSearchResult:
    normalized_query = query_text.strip()
    search_keywords = _unique_keep_order(list(keywords or []))
    black_limit = black_top_k or settings.detection_retrieval_black_top_k
    white_limit = white_top_k or settings.detection_retrieval_white_top_k
    vector_limit = vector_top_k or settings.detection_retrieval_vector_top_k
    keyword_limit = keyword_top_k or settings.detection_retrieval_keyword_top_k

    embedding_literal: str | None = None
    try:
        embedding_literal = _embed_query_text(normalized_query)
    except Exception:  # noqa: BLE001 - 查询阶段允许降级到关键词检索
        embedding_literal = None

    def run_for_label(sample_label: str, limit: int) -> list[repository.TextChunkSearchHit]:
        vector_hits: list[repository.TextChunkSearchHit] = []
        keyword_hits: list[repository.TextChunkSearchHit] = []
        if embedding_literal is not None:
            vector_hits = repository.search_text_chunks_by_vector(
                db,
                query_embedding_literal=embedding_literal,
                embedding_model=settings.rag_embedding_model,
                sample_label=sample_label,
                limit=vector_limit,
            )
        try:
            keyword_hits = repository.search_text_chunks_by_keyword(
                db,
                query_text=normalized_query,
                keywords=search_keywords,
                embedding_model=settings.rag_embedding_model,
                sample_label=sample_label,
                limit=keyword_limit,
            )
        except Exception:  # noqa: BLE001 - 没有 trigram 索引时允许退化
            keyword_hits = []
        return _merge_hits(vector_hits=vector_hits, keyword_hits=keyword_hits, limit=limit)

    black_hits = run_for_label("black", black_limit)
    white_hits = run_for_label("white", white_limit)

    return ComparativeSearchResult(
        query_text=normalized_query,
        keywords=search_keywords,
        black_hits=black_hits,
        white_hits=white_hits,
    )
