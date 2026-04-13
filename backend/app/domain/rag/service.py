"""Application service for RAG text ingestion jobs."""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.domain.rag import chunking, repository
from app.domain.rag.embedding import build_embedding_client
from app.domain.rag.entity import RagIngestJob
from app.shared.core.config import settings
from app.shared.db.session import SessionLocal

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class PreparedChunk:
    chunk_index: int
    chunk_text: str
    content_hash: str
    extra_meta: dict[str, Any]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stable_json_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _serialize_vector(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def _build_source_hash(source: repository.SourceRecord) -> str:
    return _stable_json_hash(
        {
            "content": chunking.normalize_text(source.content),
            "sample_label": source.sample_label,
            "fraud_type": source.fraud_type,
            "data_source": source.data_source,
            "url": source.url,
            "task_type": source.task_type,
        }
    )


def _build_retrieval_text(source: repository.SourceRecord) -> str:
    normalized_content = chunking.normalize_text(source.content)
    if not normalized_content:
        return ""
    if "website" in source.task_type and source.url:
        return f"URL: {source.url}\n{normalized_content}"
    return normalized_content


def _prepare_chunks(source: repository.SourceRecord) -> list[PreparedChunk]:
    retrieval_text = _build_retrieval_text(source)
    chunks = chunking.split_text(
        retrieval_text,
        soft_limit=settings.rag_text_chunk_soft_limit,
        hard_limit=settings.rag_text_chunk_hard_limit,
        overlap=settings.rag_text_chunk_overlap,
    )
    prepared: list[PreparedChunk] = []
    for index, chunk_text in enumerate(chunks):
        content_hash = _stable_json_hash(
            {
                "source_id": source.id,
                "chunk_index": index,
                "chunk_text": chunk_text,
                "sample_label": source.sample_label,
                "fraud_type": source.fraud_type,
                "data_source": source.data_source,
                "url": source.url,
            }
        )
        prepared.append(
            PreparedChunk(
                chunk_index=index,
                chunk_text=chunk_text,
                content_hash=content_hash,
                extra_meta={
                    "task_type": source.task_type,
                    "chunking_version": "text-v1",
                    "source_char_count": len(retrieval_text),
                },
            )
        )
    return prepared


def _build_job_filters(
    *,
    source_ids: list[int] | None,
    source_id_min: int | None,
    source_id_max: int | None,
    data_sources: list[str] | None,
    force: bool,
    limit: int | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"force": force}
    if source_ids:
        payload["source_ids"] = sorted({int(value) for value in source_ids})
    if source_id_min is not None:
        payload["source_id_min"] = int(source_id_min)
    if source_id_max is not None:
        payload["source_id_max"] = int(source_id_max)
    if data_sources:
        payload["data_sources"] = [value.strip() for value in data_sources if value.strip()]
    if limit is not None:
        payload["limit"] = int(limit)
    return payload


def create_backfill_job(
    db: Session,
    *,
    source_ids: list[int] | None,
    source_id_min: int | None,
    source_id_max: int | None,
    data_sources: list[str] | None,
    force: bool,
    limit: int | None,
) -> RagIngestJob:
    filters = _build_job_filters(
        source_ids=source_ids,
        source_id_min=source_id_min,
        source_id_max=source_id_max,
        data_sources=data_sources,
        force=force,
        limit=limit,
    )
    total_count = repository.count_sources_for_filters(db, filters)
    if limit is not None:
        total_count = min(total_count, int(limit))
    return repository.create_job(
        db,
        job_type="backfill",
        modality="text",
        filters=filters,
        embedding_model=settings.rag_embedding_model,
        total_count=total_count,
    )


def list_jobs(db: Session, *, limit: int) -> list[RagIngestJob]:
    return repository.list_jobs(db, limit=limit)


def get_job(db: Session, job_id: uuid.UUID) -> RagIngestJob | None:
    return repository.get_job(db, job_id)


def _effective_filters(job: RagIngestJob) -> dict[str, Any]:
    return dict(job.filters or {})


def _should_skip_source(
    *,
    job: RagIngestJob,
    sync_state: Any,
    source_hash: str,
) -> bool:
    if bool((job.filters or {}).get("force")):
        return False
    if sync_state is None:
        return False
    return (
        sync_state.source_hash == source_hash
        and sync_state.status in {"completed", "empty"}
        and sync_state.embedding_model == job.embedding_model
    )


def _apply_completed_source(
    db: Session,
    *,
    job: RagIngestJob,
    source: repository.SourceRecord,
    source_hash: str,
    prepared_chunks: list[PreparedChunk],
    vectors: list[list[float]],
) -> None:
    writes = [
        repository.TextChunkWrite(
            source_id=source.id,
            chunk_index=chunk.chunk_index,
            chunk_text=chunk.chunk_text,
            chunk_char_count=len(chunk.chunk_text),
            sample_label=source.sample_label,
            fraud_type=source.fraud_type,
            data_source=source.data_source,
            url=source.url,
            content_hash=chunk.content_hash,
            embedding_model=job.embedding_model,
            embedding_dim=settings.rag_embedding_dimensions,
            embedding_literal=_serialize_vector(vector),
            extra_meta=chunk.extra_meta,
        )
        for chunk, vector in zip(prepared_chunks, vectors, strict=True)
    ]
    repository.replace_text_chunks(
        db,
        source_id=source.id,
        embedding_model=job.embedding_model,
        chunks=writes,
    )
    state = repository.upsert_sync_state(
        db,
        source_id=source.id,
        modality=job.modality,
        embedding_model=job.embedding_model,
        source_hash=source_hash,
        status="completed",
        chunk_count=len(writes),
        last_job_id=job.id,
        last_error=None,
    )
    state.last_synced_at = _utcnow()
    db.add(state)


def _apply_empty_source(
    db: Session,
    *,
    job: RagIngestJob,
    source: repository.SourceRecord,
    source_hash: str,
) -> None:
    repository.replace_text_chunks(
        db,
        source_id=source.id,
        embedding_model=job.embedding_model,
        chunks=[],
    )
    state = repository.upsert_sync_state(
        db,
        source_id=source.id,
        modality=job.modality,
        embedding_model=job.embedding_model,
        source_hash=source_hash,
        status="empty",
        chunk_count=0,
        last_job_id=job.id,
        last_error=None,
    )
    state.last_synced_at = _utcnow()
    db.add(state)


def _mark_source_failed(
    db: Session,
    *,
    job: RagIngestJob,
    source: repository.SourceRecord,
    source_hash: str,
    error_message: str,
) -> None:
    repository.upsert_sync_state(
        db,
        source_id=source.id,
        modality=job.modality,
        embedding_model=job.embedding_model,
        source_hash=source_hash,
        status="failed",
        chunk_count=0,
        last_job_id=job.id,
        last_error=error_message[:2000],
    )


def process_job(db: Session, job_id: uuid.UUID) -> RagIngestJob:
    job = repository.get_job(db, job_id)
    if job is None:
        raise RuntimeError(f"RAG job not found: {job_id}")
    if job.status == "running":
        return job

    job.status = "running"
    job.error_message = None
    job.started_at = _utcnow()
    job.finished_at = None
    repository.save_job(db, job)

    filters = _effective_filters(job)
    max_count = filters.get("limit")
    client = build_embedding_client()
    processed_sources = 0
    success_count = 0
    fail_count = 0
    skipped_count = 0
    after_source_id = 0

    try:
        while True:
            if max_count is not None and processed_sources >= int(max_count):
                break

            batch_limit = settings.rag_source_batch_size
            if max_count is not None:
                batch_limit = min(batch_limit, int(max_count) - processed_sources)

            sources = repository.fetch_sources_for_filters(
                db,
                filters,
                after_source_id=after_source_id,
                limit=batch_limit,
            )
            if not sources:
                break

            after_source_id = sources[-1].id
            sync_states = repository.get_sync_states(
                db,
                source_ids=[source.id for source in sources],
                embedding_model=job.embedding_model,
                modality=job.modality,
            )

            for source in sources:
                source_hash = _build_source_hash(source)
                sync_state = sync_states.get(source.id)
                processed_sources += 1

                if _should_skip_source(job=job, sync_state=sync_state, source_hash=source_hash):
                    skipped_count += 1
                    continue

                prepared_chunks = _prepare_chunks(source)
                if not prepared_chunks:
                    try:
                        _apply_empty_source(db, job=job, source=source, source_hash=source_hash)
                        db.commit()
                        success_count += 1
                    except Exception as exc:  # noqa: BLE001
                        db.rollback()
                        fail_count += 1
                        _mark_source_failed(
                            db,
                            job=job,
                            source=source,
                            source_hash=source_hash,
                            error_message=str(exc),
                        )
                        db.commit()
                    continue

                try:
                    texts = [chunk.chunk_text for chunk in prepared_chunks]
                    result = client.embed_texts(texts)
                    _apply_completed_source(
                        db,
                        job=job,
                        source=source,
                        source_hash=source_hash,
                        prepared_chunks=prepared_chunks,
                        vectors=result.vectors,
                    )
                    db.commit()
                    success_count += 1
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    fail_count += 1
                    _mark_source_failed(
                        db,
                        job=job,
                        source=source,
                        source_hash=source_hash,
                        error_message=str(exc),
                    )
                    db.commit()

                job.success_count = success_count
                job.fail_count = fail_count
                job.skipped_count = skipped_count
                db.add(job)
                db.commit()
                db.refresh(job)

        job.status = "completed"
        job.success_count = success_count
        job.fail_count = fail_count
        job.skipped_count = skipped_count
        job.finished_at = _utcnow()
        repository.save_job(db, job)
        return job
    except Exception as exc:  # noqa: BLE001
        logger.exception("RAG job failed: %s", job.id)
        db.rollback()
        job.status = "failed"
        job.error_message = str(exc)[:4000]
        job.finished_at = _utcnow()
        repository.save_job(db, job)
        raise


def process_job_in_new_session(job_id: uuid.UUID) -> None:
    db = SessionLocal()
    try:
        process_job(db, job_id)
    finally:
        db.close()


def process_next_pending_job() -> RagIngestJob | None:
    db = SessionLocal()
    try:
        job = repository.get_next_pending_job(db)
        if job is None:
            return None
        return process_job(db, job.id)
    finally:
        db.close()
