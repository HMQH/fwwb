from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.cases import repository as cases_repository
from app.domain.cases.entity import FraudCase
from app.domain.library import repository
from app.domain.rag import service as rag_service


def _normalize_list(values: list[str] | None, *, limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in values or []:
        normalized = str(item).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def _flatten_detail_blocks(blocks: list[dict[str, Any]] | None, *, limit: int) -> list[str]:
    paragraphs: list[str] = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        title = str(block.get("title") or "").strip()
        if title:
            paragraphs.append(title)
        for item in block.get("paragraphs") or []:
            normalized = str(item).strip()
            if normalized:
                paragraphs.append(normalized)
        if len(paragraphs) >= limit:
            break
    return paragraphs[:limit]


def _build_case_source_content(case: FraudCase) -> str:
    lines = [case.title.strip()]
    if case.summary:
        lines.append(case.summary.strip())
    if case.fraud_type:
        lines.append(f"诈骗类型：{case.fraud_type}")
    warnings = _normalize_list(list(case.warning_signs or []), limit=6)
    if warnings:
        lines.append("风险信号：" + "；".join(warnings))
    actions = _normalize_list(list(case.prevention_actions or []), limit=6)
    if actions:
        lines.append("防护建议：" + "；".join(actions))
    tags = _normalize_list(list(case.tags or []), limit=8)
    if tags:
        lines.append("标签：" + "、".join(tags))
    lines.extend(_flatten_detail_blocks(list(case.detail_blocks or []), limit=10))
    return "\n".join([item for item in lines if item]).strip()


def _build_payload(
    *,
    data_source: str,
    sample_label: str,
    fraud_type: str | None,
    content: str,
    url: str | None,
) -> repository.SourceRecordPayload:
    return repository.SourceRecordPayload(
        data_source=data_source,
        sample_label=sample_label,
        fraud_type=fraud_type,
        task_type=["text", "website"] if url else ["text"],
        content=content,
        url=url,
        image_path=[],
        video_path=[],
    )


def _run_rag_backfill(db: Session, *, source_ids: list[int]) -> list[str]:
    if not source_ids:
        return []
    job = rag_service.create_backfill_job(
        db,
        source_ids=source_ids,
        source_id_min=None,
        source_id_max=None,
        data_sources=None,
        force=True,
        limit=len(source_ids),
    )
    rag_service.process_job(db, job.id)
    return [str(job.id)]


def sync_case_to_library(db: Session, *, case: FraudCase) -> tuple[int, list[str]]:
    content = _build_case_source_content(case)
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="案例内容为空，无法写入知识库")
    payload = _build_payload(
        data_source=f"case:{case.source_name}",
        sample_label="black",
        fraud_type=case.fraud_type,
        content=content,
        url=case.source_article_url,
    )
    if case.knowledge_source_id and repository.source_record_exists(db, case.knowledge_source_id):
        repository.update_source_record(db, case.knowledge_source_id, payload)
        source_id = int(case.knowledge_source_id)
    else:
        source_id = repository.insert_source_record(db, payload)
    job_ids = _run_rag_backfill(db, source_ids=[source_id])
    return source_id, job_ids


def remove_case_from_library(db: Session, *, case: FraudCase) -> None:
    if not case.knowledge_source_id:
        return
    source_id = int(case.knowledge_source_id)
    if repository.source_record_exists(db, source_id):
        repository.delete_source_record(db, source_id)
    case.knowledge_source_id = None


def list_sources(
    db: Session,
    *,
    search: str | None,
    sample_label: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    rows = repository.list_sources(db, search=search, sample_label=sample_label, limit=limit)
    return [serialize_source(row) for row in rows]


def count_sources(db: Session) -> int:
    return repository.count_sources(db)


def delete_source(db: Session, *, source_id: int) -> None:
    if not repository.source_record_exists(db, source_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库记录不存在")
    repository.delete_source_record(db, source_id)
    cases_repository.clear_knowledge_source_reference(db, source_id=source_id)


def import_text_source(
    db: Session,
    *,
    title: str | None,
    content: str,
    sample_label: str,
    fraud_type: str | None,
    url: str | None,
    data_source: str | None,
) -> dict[str, Any]:
    normalized_content = content.strip()
    if not normalized_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="导入内容不能为空")
    lines = [title.strip()] if title and title.strip() else []
    lines.append(normalized_content)
    payload = _build_payload(
        data_source=(data_source or "admin_upload").strip() or "admin_upload",
        sample_label=sample_label,
        fraud_type=(fraud_type or "").strip() or None,
        content="\n".join(lines),
        url=(url or "").strip() or None,
    )
    source_id = repository.insert_source_record(db, payload)
    job_ids = _run_rag_backfill(db, source_ids=[source_id])
    rows = repository.list_sources(db, search=None, sample_label=None, limit=1)
    current = next((row for row in rows if int(row["id"]) == source_id), None)
    return {
        "item": serialize_source(current or {
            "id": source_id,
            "data_source": payload.data_source,
            "sample_label": payload.sample_label,
            "fraud_type": payload.fraud_type,
            "task_type": payload.task_type,
            "content": payload.content,
            "url": payload.url,
            "image_path": [],
            "video_path": [],
        }),
        "rag_job_ids": job_ids,
    }


def decode_upload_content(filename: str | None, data: bytes) -> tuple[str, str]:
    suffix = Path(filename or "").suffix.lower()
    encodings = ["utf-8", "utf-8-sig", "gb18030", "utf-16"]
    text_content = ""
    for encoding in encodings:
        try:
            text_content = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if not text_content:
        text_content = data.decode("utf-8", errors="ignore")
    return suffix, text_content.replace("\x00", "").strip()


def serialize_source(row: dict[str, Any]) -> dict[str, Any]:
    content = str(row.get("content") or "").strip()
    preview = content[:180] + ("…" if len(content) > 180 else "")
    return {
        "id": int(row.get("id") or 0),
        "data_source": row.get("data_source"),
        "sample_label": row.get("sample_label"),
        "fraud_type": row.get("fraud_type"),
        "task_type": list(row.get("task_type") or []),
        "content": content,
        "preview": preview,
        "url": row.get("url"),
        "image_path": list(row.get("image_path") or []),
        "video_path": list(row.get("video_path") or []),
    }
