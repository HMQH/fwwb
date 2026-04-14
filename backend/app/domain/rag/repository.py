"""RAG 作业持久化与查询。"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.domain.rag.entity import RagIngestJob, RagSourceSyncState


@dataclass(slots=True)
class SourceRecord:
    id: int
    data_source: str | None
    sample_label: str
    fraud_type: str | None
    content: str
    url: str | None
    task_type: list[str]


@dataclass(slots=True)
class TextChunkWrite:
    source_id: int
    chunk_index: int
    chunk_text: str
    chunk_char_count: int
    sample_label: str
    fraud_type: str | None
    data_source: str | None
    url: str | None
    content_hash: str
    embedding_model: str
    embedding_dim: int
    embedding_literal: str
    extra_meta: dict[str, Any]


@dataclass(slots=True)
class TextChunkSearchHit:
    source_id: int
    chunk_index: int
    chunk_text: str
    sample_label: str
    fraud_type: str | None
    data_source: str | None
    url: str | None
    content_hash: str
    embedding_model: str
    score: float
    match_source: str
    extra_meta: dict[str, Any]


# ===== sources_all_data -> rag_text_chunks 入库相关 =====
def _build_source_query(
    filters: dict[str, Any],
    *,
    count_only: bool,
    after_source_id: int | None = None,
    limit: int | None = None,
):
    select_clause = "COUNT(*) AS total_count" if count_only else (
        "id, data_source, sample_label, fraud_type, content, url, task_type"
    )
    sql_parts = [
        f"SELECT {select_clause}",
        "FROM public.sources_all_data",
        "WHERE content IS NOT NULL",
        "  AND btrim(content) <> ''",
        "  AND (task_type ? 'text' OR task_type ? 'website')",
    ]
    params: dict[str, Any] = {}
    expanding_binds: list[str] = []

    source_id_min = filters.get("source_id_min")
    source_id_max = filters.get("source_id_max")
    source_ids = filters.get("source_ids") or []
    data_sources = filters.get("data_sources") or []

    if source_id_min is not None:
        sql_parts.append("  AND id >= :source_id_min")
        params["source_id_min"] = int(source_id_min)
    if source_id_max is not None:
        sql_parts.append("  AND id <= :source_id_max")
        params["source_id_max"] = int(source_id_max)
    if source_ids:
        sql_parts.append("  AND id IN :source_ids")
        params["source_ids"] = [int(value) for value in source_ids]
        expanding_binds.append("source_ids")
    if data_sources:
        sql_parts.append("  AND data_source IN :data_sources")
        params["data_sources"] = [str(value) for value in data_sources]
        expanding_binds.append("data_sources")
    if after_source_id is not None:
        sql_parts.append("  AND id > :after_source_id")
        params["after_source_id"] = int(after_source_id)

    if not count_only:
        sql_parts.append("ORDER BY id")
        if limit is not None:
            sql_parts.append("LIMIT :limit")
            params["limit"] = int(limit)

    statement = text("\n".join(sql_parts))
    for bind_name in expanding_binds:
        statement = statement.bindparams(bindparam(bind_name, expanding=True))
    return statement, params


def count_sources_for_filters(db: Session, filters: dict[str, Any]) -> int:
    statement, params = _build_source_query(filters, count_only=True)
    return int(db.execute(statement, params).scalar_one())


def fetch_sources_for_filters(
    db: Session,
    filters: dict[str, Any],
    *,
    after_source_id: int,
    limit: int,
) -> list[SourceRecord]:
    statement, params = _build_source_query(
        filters,
        count_only=False,
        after_source_id=after_source_id,
        limit=limit,
    )
    rows = db.execute(statement, params).mappings().all()
    return [
        SourceRecord(
            id=int(row["id"]),
            data_source=row["data_source"],
            sample_label=row["sample_label"],
            fraud_type=row["fraud_type"],
            content=row["content"],
            url=row["url"],
            task_type=list(row["task_type"] or []),
        )
        for row in rows
    ]


# ===== RAG ingestion job helpers =====
def create_job(
    db: Session,
    *,
    job_type: str,
    modality: str,
    filters: dict[str, Any],
    embedding_model: str,
    total_count: int,
) -> RagIngestJob:
    job = RagIngestJob(
        job_type=job_type,
        modality=modality,
        status="pending",
        filters=filters,
        embedding_model=embedding_model,
        total_count=total_count,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job(db: Session, job_id: uuid.UUID) -> RagIngestJob | None:
    return db.get(RagIngestJob, job_id)


def list_jobs(db: Session, *, limit: int) -> list[RagIngestJob]:
    stmt = select(RagIngestJob).order_by(RagIngestJob.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


def get_next_pending_job(db: Session) -> RagIngestJob | None:
    stmt = (
        select(RagIngestJob)
        .where(RagIngestJob.status == "pending")
        .order_by(RagIngestJob.created_at.asc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def save_job(db: Session, job: RagIngestJob) -> RagIngestJob:
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_sync_states(
    db: Session,
    *,
    source_ids: list[int],
    embedding_model: str,
    modality: str,
) -> dict[int, RagSourceSyncState]:
    if not source_ids:
        return {}
    stmt = (
        select(RagSourceSyncState)
        .where(RagSourceSyncState.source_id.in_(source_ids))
        .where(RagSourceSyncState.embedding_model == embedding_model)
        .where(RagSourceSyncState.modality == modality)
    )
    rows = db.execute(stmt).scalars().all()
    return {int(row.source_id): row for row in rows}


def upsert_sync_state(
    db: Session,
    *,
    source_id: int,
    modality: str,
    embedding_model: str,
    source_hash: str,
    status: str,
    chunk_count: int,
    last_job_id: uuid.UUID,
    last_error: str | None,
) -> RagSourceSyncState:
    stmt = (
        select(RagSourceSyncState)
        .where(RagSourceSyncState.source_id == source_id)
        .where(RagSourceSyncState.modality == modality)
        .where(RagSourceSyncState.embedding_model == embedding_model)
        .limit(1)
    )
    state = db.execute(stmt).scalars().first()
    if state is None:
        state = RagSourceSyncState(
            source_id=source_id,
            modality=modality,
            embedding_model=embedding_model,
            source_hash=source_hash,
            status=status,
            chunk_count=chunk_count,
            last_job_id=last_job_id,
            last_error=last_error,
        )
    else:
        state.source_hash = source_hash
        state.status = status
        state.chunk_count = chunk_count
        state.last_job_id = last_job_id
        state.last_error = last_error
    db.add(state)
    db.flush()
    db.refresh(state)
    return state


def replace_text_chunks(
    db: Session,
    *,
    source_id: int,
    embedding_model: str,
    chunks: list[TextChunkWrite],
) -> None:
    delete_stmt = text(
        """
        DELETE FROM public.rag_text_chunks
        WHERE source_id = :source_id
          AND embedding_model = :embedding_model
        """
    )
    db.execute(delete_stmt, {"source_id": source_id, "embedding_model": embedding_model})
    if not chunks:
        return

    insert_stmt = text(
        """
        INSERT INTO public.rag_text_chunks (
          source_id,
          chunk_index,
          chunk_text,
          chunk_char_count,
          sample_label,
          fraud_type,
          data_source,
          url,
          content_hash,
          embedding_model,
          embedding_dim,
          embedding,
          is_active,
          extra_meta
        ) VALUES (
          :source_id,
          :chunk_index,
          :chunk_text,
          :chunk_char_count,
          :sample_label,
          :fraud_type,
          :data_source,
          :url,
          :content_hash,
          :embedding_model,
          :embedding_dim,
          CAST(:embedding AS vector),
          true,
          CAST(:extra_meta AS jsonb)
        )
        """
    )
    payload = [
        {
            "source_id": chunk.source_id,
            "chunk_index": chunk.chunk_index,
            "chunk_text": chunk.chunk_text,
            "chunk_char_count": chunk.chunk_char_count,
            "sample_label": chunk.sample_label,
            "fraud_type": chunk.fraud_type,
            "data_source": chunk.data_source,
            "url": chunk.url,
            "content_hash": chunk.content_hash,
            "embedding_model": chunk.embedding_model,
            "embedding_dim": chunk.embedding_dim,
            "embedding": chunk.embedding_literal,
            "extra_meta": json.dumps(chunk.extra_meta, ensure_ascii=False),
        }
        for chunk in chunks
    ]
    db.execute(insert_stmt, payload)


# ===== 文本检测检索 =====
def _map_search_rows(rows: list[dict[str, Any]], *, match_source: str) -> list[TextChunkSearchHit]:
    return [
        TextChunkSearchHit(
            source_id=int(row["source_id"]),
            chunk_index=int(row["chunk_index"]),
            chunk_text=str(row["chunk_text"]),
            sample_label=str(row["sample_label"]),
            fraud_type=row["fraud_type"],
            data_source=row["data_source"],
            url=row["url"],
            content_hash=str(row["content_hash"]),
            embedding_model=str(row["embedding_model"]),
            score=float(row["score"]),
            match_source=match_source,
            extra_meta=dict(row["extra_meta"] or {}),
        )
        for row in rows
    ]


def search_text_chunks_by_vector(
    db: Session,
    *,
    query_embedding_literal: str,
    embedding_model: str,
    sample_label: str,
    limit: int,
) -> list[TextChunkSearchHit]:
    statement = text(
        """
        SELECT
          source_id,
          chunk_index,
          chunk_text,
          sample_label,
          fraud_type,
          data_source,
          url,
          content_hash,
          embedding_model,
          extra_meta,
          (1 - (embedding <=> CAST(:query_embedding AS vector))) AS score
        FROM public.rag_text_chunks
        WHERE is_active = true
          AND embedding_model = :embedding_model
          AND sample_label = :sample_label
        ORDER BY embedding <=> CAST(:query_embedding AS vector)
        LIMIT :limit
        """
    )
    rows = db.execute(
        statement,
        {
            "query_embedding": query_embedding_literal,
            "embedding_model": embedding_model,
            "sample_label": sample_label,
            "limit": int(limit),
        },
    ).mappings().all()
    return _map_search_rows(rows, match_source="vector")


def search_text_chunks_by_keyword(
    db: Session,
    *,
    query_text: str,
    keywords: list[str],
    embedding_model: str,
    sample_label: str,
    limit: int,
) -> list[TextChunkSearchHit]:
    normalized_query = (query_text or "").strip()
    normalized_keywords = [keyword.strip() for keyword in keywords if keyword.strip()]
    if not normalized_query and not normalized_keywords:
        return []

    params: dict[str, Any] = {
        "query_text": normalized_query,
        "embedding_model": embedding_model,
        "sample_label": sample_label,
        "limit": int(limit),
    }
    match_clauses: list[str] = []
    bonus_terms: list[str] = []

    query_like_bonus = "0"
    if normalized_query:
        params["query_like"] = f"%{normalized_query[:120]}%"
        match_clauses.append("similarity(chunk_text, :query_text) > 0.05")
        match_clauses.append("chunk_text ILIKE :query_like")
        query_like_bonus = "CASE WHEN chunk_text ILIKE :query_like THEN 1 ELSE 0 END"

    for index, keyword in enumerate(normalized_keywords[:8]):
        key = f"keyword_like_{index}"
        params[key] = f"%{keyword}%"
        match_clauses.append(f"chunk_text ILIKE :{key}")
        bonus_terms.append(f"CASE WHEN chunk_text ILIKE :{key} THEN 1 ELSE 0 END")

    if not match_clauses:
        return []

    keyword_bonus_expr = " + ".join(bonus_terms) if bonus_terms else "0"
    statement = text(
        f"""
        SELECT
          source_id,
          chunk_index,
          chunk_text,
          sample_label,
          fraud_type,
          data_source,
          url,
          content_hash,
          embedding_model,
          extra_meta,
          (
            (GREATEST(similarity(chunk_text, :query_text), 0) * 0.72)
            + (({keyword_bonus_expr}) * 0.08)
            + (({query_like_bonus}) * 0.2)
          ) AS score
        FROM public.rag_text_chunks
        WHERE is_active = true
          AND embedding_model = :embedding_model
          AND sample_label = :sample_label
          AND ({' OR '.join(match_clauses)})
        ORDER BY score DESC, chunk_char_count ASC
        LIMIT :limit
        """
    )
    rows = db.execute(statement, params).mappings().all()
    return _map_search_rows(rows, match_source="keyword")
