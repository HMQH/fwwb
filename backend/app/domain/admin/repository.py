"""Admin analytics repository."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

_REPORT_TZ = "Asia/Shanghai"
_ADMIN_SCHEMA_READY = False


def ensure_admin_schema(db: Session) -> None:
    global _ADMIN_SCHEMA_READY
    if _ADMIN_SCHEMA_READY:
        return

    statements = [
        """
        CREATE TABLE IF NOT EXISTS public.detection_feedback (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          submission_id uuid NOT NULL REFERENCES public.detection_submissions(id) ON DELETE CASCADE,
          job_id uuid NULL REFERENCES public.detection_jobs(id) ON DELETE SET NULL,
          result_id uuid NULL REFERENCES public.detection_results(id) ON DELETE SET NULL,
          user_label text NOT NULL DEFAULT 'unknown',
          reviewed_fraud_type text NULL,
          helpful boolean NULL,
          note text NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """,
        """
        ALTER TABLE public.detection_feedback
          ADD COLUMN IF NOT EXISTS user_id uuid NULL,
          ADD COLUMN IF NOT EXISTS submission_id uuid NULL,
          ADD COLUMN IF NOT EXISTS job_id uuid NULL,
          ADD COLUMN IF NOT EXISTS result_id uuid NULL,
          ADD COLUMN IF NOT EXISTS user_label text NOT NULL DEFAULT 'unknown',
          ADD COLUMN IF NOT EXISTS reviewed_fraud_type text NULL,
          ADD COLUMN IF NOT EXISTS helpful boolean NULL,
          ADD COLUMN IF NOT EXISTS note text NULL,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
        """,
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'detection_feedback_user_label_check'
          ) THEN
            ALTER TABLE public.detection_feedback
              ADD CONSTRAINT detection_feedback_user_label_check
              CHECK (user_label IN ('unknown', 'fraud', 'safe'));
          END IF;
        END $$;
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_detection_feedback_updated_at
          ON public.detection_feedback (updated_at DESC, created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_detection_feedback_job_id
          ON public.detection_feedback (job_id)
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_detection_feedback_user_job
          ON public.detection_feedback (user_id, job_id)
          WHERE job_id IS NOT NULL
        """,
    ]
    for statement in statements:
        db.execute(text(statement))
    db.commit()
    _ADMIN_SCHEMA_READY = True


def get_detection_modality_counts(db: Session) -> dict[str, int]:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          COUNT(*) AS submission_total,
          COUNT(*) FILTER (WHERE has_text) AS text_count,
          COUNT(*) FILTER (WHERE has_audio) AS audio_count,
          COUNT(*) FILTER (WHERE has_image) AS image_count,
          COUNT(*) FILTER (WHERE has_video) AS video_count
        FROM public.detection_submissions
        """
    )
    row = db.execute(stmt).mappings().one()
    return {
        key: int(row.get(key) or 0)
        for key in ("submission_total", "text_count", "audio_count", "image_count", "video_count")
    }


def get_detection_trend(db: Session, *, days: int = 7) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        f"""
        WITH day_series AS (
          SELECT generate_series(
            (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date,
            timezone('{_REPORT_TZ}', now())::date,
            interval '1 day'
          )::date AS day
        ),
        daily AS (
          SELECT
            timezone('{_REPORT_TZ}', created_at)::date AS day,
            SUM(CASE WHEN has_text THEN 1 ELSE 0 END) AS text_count,
            SUM(CASE WHEN has_audio THEN 1 ELSE 0 END) AS audio_count,
            SUM(CASE WHEN has_image THEN 1 ELSE 0 END) AS image_count,
            SUM(CASE WHEN has_video THEN 1 ELSE 0 END) AS video_count
          FROM public.detection_submissions
          WHERE timezone('{_REPORT_TZ}', created_at)::date >=
            (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date
          GROUP BY 1
        )
        SELECT
          to_char(day_series.day, 'MM/DD') AS day_label,
          COALESCE(daily.text_count, 0) AS text_count,
          COALESCE(daily.audio_count, 0) AS audio_count,
          COALESCE(daily.image_count, 0) AS image_count,
          COALESCE(daily.video_count, 0) AS video_count
        FROM day_series
        LEFT JOIN daily ON daily.day = day_series.day
        ORDER BY day_series.day
        """
    )
    return [dict(row) for row in db.execute(stmt, {"days": days}).mappings().all()]


def get_risk_level_counts(db: Session) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          COALESCE(NULLIF(btrim(risk_level), ''), 'unknown') AS risk_level,
          COUNT(*)::bigint AS total
        FROM public.detection_results
        GROUP BY 1
        """
    )
    return [dict(row) for row in db.execute(stmt).mappings().all()]


def get_fraud_type_counts(db: Session, *, limit: int = 7) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          COALESCE(NULLIF(btrim(fraud_type), ''), '未分类') AS fraud_type,
          COUNT(*)::bigint AS total
        FROM public.detection_results
        GROUP BY 1
        ORDER BY total DESC, fraud_type ASC
        LIMIT :limit
        """
    )
    return [dict(row) for row in db.execute(stmt, {"limit": limit}).mappings().all()]


def get_feedback_summary(db: Session) -> dict[str, int]:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE user_label = 'fraud')::bigint AS fraud_total,
          COUNT(*) FILTER (WHERE user_label = 'safe')::bigint AS safe_total,
          COUNT(*) FILTER (WHERE helpful IS TRUE)::bigint AS helpful_total
        FROM public.detection_feedback
        """
    )
    row = db.execute(stmt).mappings().one()
    return {
        "total": int(row.get("total") or 0),
        "fraud_total": int(row.get("fraud_total") or 0),
        "safe_total": int(row.get("safe_total") or 0),
        "helpful_total": int(row.get("helpful_total") or 0),
    }


def get_feedback_trend(db: Session, *, days: int = 7) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        f"""
        WITH day_series AS (
          SELECT generate_series(
            (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date,
            timezone('{_REPORT_TZ}', now())::date,
            interval '1 day'
          )::date AS day
        ),
        daily AS (
          SELECT
            timezone('{_REPORT_TZ}', created_at)::date AS day,
            COUNT(*)::bigint AS total_count,
            COUNT(*) FILTER (WHERE helpful IS TRUE)::bigint AS helpful_count
          FROM public.detection_feedback
          WHERE timezone('{_REPORT_TZ}', created_at)::date >=
            (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date
          GROUP BY 1
        )
        SELECT
          to_char(day_series.day, 'MM/DD') AS day_label,
          COALESCE(daily.total_count, 0) AS total_count,
          COALESCE(daily.helpful_count, 0) AS helpful_count
        FROM day_series
        LEFT JOIN daily ON daily.day = day_series.day
        ORDER BY day_series.day
        """
    )
    return [dict(row) for row in db.execute(stmt, {"days": days}).mappings().all()]


def get_feedback_correction_counts(db: Session) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        """
        WITH feedback_view AS (
          SELECT
            CASE
              WHEN f.user_label = 'safe' AND COALESCE(r.is_fraud, false) IS TRUE THEN '误判'
              WHEN f.user_label = 'fraud' AND COALESCE(r.is_fraud, false) IS FALSE THEN '漏判'
              WHEN COALESCE(NULLIF(btrim(f.reviewed_fraud_type), ''), '') <> '' THEN '补充信息'
              WHEN COALESCE(NULLIF(btrim(f.note), ''), '') <> '' THEN '补充信息'
              ELSE '其他'
            END AS correction_type
          FROM public.detection_feedback f
          LEFT JOIN public.detection_results r ON r.id = f.result_id
        )
        SELECT correction_type, COUNT(*)::bigint AS total
        FROM feedback_view
        GROUP BY 1
        """
    )
    return [dict(row) for row in db.execute(stmt).mappings().all()]


def get_rag_vector_overview(db: Session, *, embedding_model: str) -> dict[str, Any]:
    ensure_admin_schema(db)
    stmt = text(
        """
        WITH source_total AS (
          SELECT COUNT(*)::bigint AS total
          FROM public.sources_all_data
        ),
        sync_state AS (
          SELECT source_id, status, chunk_count, last_synced_at
          FROM public.rag_source_sync_state
          WHERE embedding_model = :embedding_model
            AND modality = 'text'
        ),
        chunk_stats AS (
          SELECT
            COUNT(*)::bigint AS chunk_total,
            COUNT(DISTINCT source_id)::bigint AS vectorized_source_total
          FROM public.rag_text_chunks
          WHERE embedding_model = :embedding_model
            AND is_active = true
        )
        SELECT
          source_total.total AS source_total,
          chunk_stats.vectorized_source_total AS vectorized_source_total,
          chunk_stats.chunk_total AS chunk_total,
          COUNT(sync_state.source_id) FILTER (WHERE sync_state.status = 'completed')::bigint AS completed_total,
          COUNT(sync_state.source_id) FILTER (WHERE sync_state.status = 'empty')::bigint AS empty_total,
          COUNT(sync_state.source_id) FILTER (WHERE sync_state.status = 'failed')::bigint AS failed_total,
          GREATEST(source_total.total - COUNT(sync_state.source_id), 0)::bigint AS pending_total,
          MAX(sync_state.last_synced_at) AS latest_synced_at
        FROM source_total
        CROSS JOIN chunk_stats
        LEFT JOIN sync_state ON TRUE
        GROUP BY source_total.total, chunk_stats.vectorized_source_total, chunk_stats.chunk_total
        """
    )
    row = db.execute(stmt, {"embedding_model": embedding_model}).mappings().one()
    return dict(row)


def get_rag_sync_trend(db: Session, *, embedding_model: str, days: int = 7) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        f"""
        WITH day_series AS (
          SELECT generate_series(
            (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date,
            timezone('{_REPORT_TZ}', now())::date,
            interval '1 day'
          )::date AS day
        ),
        daily AS (
          SELECT
            timezone('{_REPORT_TZ}', last_synced_at)::date AS day,
            COUNT(*) FILTER (WHERE status = 'completed')::bigint AS source_count,
            COALESCE(SUM(chunk_count) FILTER (WHERE status = 'completed'), 0)::bigint AS chunk_total
          FROM public.rag_source_sync_state
          WHERE embedding_model = :embedding_model
            AND modality = 'text'
            AND last_synced_at IS NOT NULL
            AND timezone('{_REPORT_TZ}', last_synced_at)::date >=
              (timezone('{_REPORT_TZ}', now())::date - (:days - 1) * interval '1 day')::date
          GROUP BY 1
        )
        SELECT
          to_char(day_series.day, 'MM/DD') AS day_label,
          COALESCE(daily.source_count, 0) AS source_count,
          COALESCE(daily.chunk_total, 0) AS chunk_total
        FROM day_series
        LEFT JOIN daily ON daily.day = day_series.day
        ORDER BY day_series.day
        """
    )
    return [dict(row) for row in db.execute(stmt, {"embedding_model": embedding_model, "days": days}).mappings().all()]


def list_feedback(db: Session, *, limit: int) -> list[dict[str, Any]]:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          f.id,
          f.user_id,
          u.display_name AS user_display_name,
          u.phone AS user_phone,
          f.submission_id,
          f.job_id,
          f.result_id,
          f.user_label,
          f.reviewed_fraud_type,
          f.helpful,
          f.note,
          s.text_content AS submission_text_content,
          r.is_fraud AS stored_is_fraud,
          r.risk_level AS stored_risk_level,
          r.fraud_type AS stored_fraud_type,
          j.status AS job_status,
          f.created_at,
          f.updated_at
        FROM public.detection_feedback f
        LEFT JOIN public.users u ON u.id = f.user_id
        LEFT JOIN public.detection_submissions s ON s.id = f.submission_id
        LEFT JOIN public.detection_jobs j ON j.id = f.job_id
        LEFT JOIN public.detection_results r ON r.id = f.result_id
        ORDER BY f.updated_at DESC, f.created_at DESC
        LIMIT :limit
        """
    )
    return [dict(row) for row in db.execute(stmt, {"limit": limit}).mappings().all()]


def get_feedback_by_user_job(
    db: Session,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
) -> dict[str, Any] | None:
    ensure_admin_schema(db)
    stmt = text(
        """
        SELECT
          id,
          user_id,
          submission_id,
          job_id,
          result_id,
          user_label,
          reviewed_fraud_type,
          helpful,
          note,
          created_at,
          updated_at
        FROM public.detection_feedback
        WHERE user_id = :user_id
          AND job_id = :job_id
        LIMIT 1
        """
    )
    row = db.execute(stmt, {"user_id": user_id, "job_id": job_id}).mappings().first()
    return dict(row) if row else None


def upsert_feedback(
    db: Session,
    *,
    user_id: uuid.UUID,
    submission_id: uuid.UUID,
    job_id: uuid.UUID,
    result_id: uuid.UUID | None,
    user_label: str,
    reviewed_fraud_type: str | None,
    helpful: bool | None,
    note: str | None,
) -> dict[str, Any]:
    ensure_admin_schema(db)
    existing = get_feedback_by_user_job(db, user_id=user_id, job_id=job_id)

    if existing is None:
        stmt = text(
            """
            INSERT INTO public.detection_feedback (
              user_id,
              submission_id,
              job_id,
              result_id,
              user_label,
              reviewed_fraud_type,
              helpful,
              note
            )
            VALUES (
              :user_id,
              :submission_id,
              :job_id,
              :result_id,
              :user_label,
              :reviewed_fraud_type,
              :helpful,
              :note
            )
            RETURNING
              id,
              user_id,
              submission_id,
              job_id,
              result_id,
              user_label,
              reviewed_fraud_type,
              helpful,
              note,
              created_at,
              updated_at
            """
        )
    else:
        stmt = text(
            """
            UPDATE public.detection_feedback
            SET
              submission_id = :submission_id,
              result_id = :result_id,
              user_label = :user_label,
              reviewed_fraud_type = :reviewed_fraud_type,
              helpful = :helpful,
              note = :note,
              updated_at = now()
            WHERE id = :id
            RETURNING
              id,
              user_id,
              submission_id,
              job_id,
              result_id,
              user_label,
              reviewed_fraud_type,
              helpful,
              note,
              created_at,
              updated_at
            """
        )

    params = {
        "id": existing.get("id") if existing else None,
        "user_id": user_id,
        "submission_id": submission_id,
        "job_id": job_id,
        "result_id": result_id,
        "user_label": user_label,
        "reviewed_fraud_type": reviewed_fraud_type,
        "helpful": helpful,
        "note": note,
    }
    row = db.execute(stmt, params).mappings().one()
    db.commit()
    return dict(row)
