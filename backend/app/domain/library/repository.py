from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(slots=True)
class SourceRecordPayload:
    data_source: str
    sample_label: str
    fraud_type: str | None
    task_type: list[str]
    content: str
    url: str | None
    image_path: list[str]
    video_path: list[str]


def _dump_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


def source_record_exists(db: Session, source_id: int) -> bool:
    stmt = text("SELECT EXISTS(SELECT 1 FROM public.sources_all_data WHERE id = :source_id)")
    return bool(db.execute(stmt, {"source_id": int(source_id)}).scalar_one())


def list_sources(
    db: Session,
    *,
    search: str | None,
    sample_label: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    sql = [
        """
        SELECT
          id,
          data_source,
          sample_label,
          fraud_type,
          task_type,
          content,
          url,
          image_path,
          video_path
        FROM public.sources_all_data
        WHERE 1 = 1
        """
    ]
    params: dict[str, Any] = {"limit": int(limit)}
    if sample_label:
        sql.append("AND sample_label = :sample_label")
        params["sample_label"] = sample_label
    if search and search.strip():
        sql.append(
            """
            AND (
              data_source ILIKE :keyword
              OR coalesce(fraud_type, '') ILIKE :keyword
              OR coalesce(url, '') ILIKE :keyword
              OR content ILIKE :keyword
            )
            """
        )
        params["keyword"] = f"%{search.strip()}%"
    sql.append("ORDER BY id DESC LIMIT :limit")
    rows = db.execute(text("\n".join(sql)), params).mappings().all()
    return [dict(row) for row in rows]


def count_sources(db: Session) -> int:
    stmt = text("SELECT COUNT(*) FROM public.sources_all_data")
    return int(db.execute(stmt).scalar_one())


def insert_source_record(db: Session, payload: SourceRecordPayload) -> int:
    stmt = text(
        """
        INSERT INTO public.sources_all_data (
          data_source,
          sample_label,
          fraud_type,
          task_type,
          content,
          url,
          audio_path,
          image_path,
          video_path
        ) VALUES (
          :data_source,
          :sample_label,
          :fraud_type,
          CAST(:task_type AS jsonb),
          :content,
          :url,
          '[]'::jsonb,
          CAST(:image_path AS jsonb),
          CAST(:video_path AS jsonb)
        )
        RETURNING id
        """
    )
    row_id = db.execute(
        stmt,
        {
            "data_source": payload.data_source,
            "sample_label": payload.sample_label,
            "fraud_type": payload.fraud_type,
            "task_type": _dump_json(payload.task_type),
            "content": payload.content,
            "url": payload.url,
            "image_path": _dump_json(payload.image_path),
            "video_path": _dump_json(payload.video_path),
        },
    ).scalar_one()
    db.commit()
    return int(row_id)


def update_source_record(db: Session, source_id: int, payload: SourceRecordPayload) -> None:
    stmt = text(
        """
        UPDATE public.sources_all_data
        SET
          data_source = :data_source,
          sample_label = :sample_label,
          fraud_type = :fraud_type,
          task_type = CAST(:task_type AS jsonb),
          content = :content,
          url = :url,
          image_path = CAST(:image_path AS jsonb),
          video_path = CAST(:video_path AS jsonb)
        WHERE id = :source_id
        """
    )
    db.execute(
        stmt,
        {
            "source_id": int(source_id),
            "data_source": payload.data_source,
            "sample_label": payload.sample_label,
            "fraud_type": payload.fraud_type,
            "task_type": _dump_json(payload.task_type),
            "content": payload.content,
            "url": payload.url,
            "image_path": _dump_json(payload.image_path),
            "video_path": _dump_json(payload.video_path),
        },
    )
    db.commit()


def delete_source_record(db: Session, source_id: int) -> None:
    db.execute(text("DELETE FROM public.rag_text_chunks WHERE source_id = :source_id"), {"source_id": int(source_id)})
    db.execute(text("DELETE FROM public.rag_source_sync_state WHERE source_id = :source_id"), {"source_id": int(source_id)})
    db.execute(text("DELETE FROM public.sources_all_data WHERE id = :source_id"), {"source_id": int(source_id)})
    db.commit()
