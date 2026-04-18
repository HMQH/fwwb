"""反诈案例模块数据访问。"""
from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.domain.cases.entity import FraudCase, FraudCaseSyncRun

_SYNC_LOCK_KEY = 620240416
_CASE_REVIEW_SCHEMA_READY = False


def ensure_case_review_schema(db: Session) -> None:
    global _CASE_REVIEW_SCHEMA_READY
    if _CASE_REVIEW_SCHEMA_READY:
        return
    statements = [
        """
        ALTER TABLE public.fraud_cases
          ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS review_note text NULL,
          ADD COLUMN IF NOT EXISTS reviewed_by text NULL,
          ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
          ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS knowledge_source_id bigint NULL
        """,
        """
        UPDATE public.fraud_cases
        SET review_status = CASE
          WHEN status = 'published' THEN 'approved'
          WHEN status = 'archived' THEN 'rejected'
          ELSE 'pending'
        END
        WHERE review_status IS NULL
           OR btrim(review_status) = ''
        """,
        """
        UPDATE public.fraud_cases
        SET content_hash = md5(
          coalesce(title, '') || '|' ||
          coalesce(summary, '') || '|' ||
          coalesce(source_article_title, '') || '|' ||
          coalesce(source_article_url, '')
        )
        WHERE content_hash IS NULL
           OR btrim(content_hash) = ''
        """,
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fraud_cases_review_status_check'
          ) THEN
            ALTER TABLE public.fraud_cases
              ADD CONSTRAINT fraud_cases_review_status_check
              CHECK (review_status IN ('pending', 'approved', 'rejected'));
          END IF;
        END $$;
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_fraud_cases_review_status
          ON public.fraud_cases (review_status, updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_fraud_cases_content_hash
          ON public.fraud_cases (content_hash)
        """,
    ]
    for statement in statements:
        db.execute(text(statement))
    db.commit()
    _CASE_REVIEW_SCHEMA_READY = True


def try_acquire_sync_lock(db: Session) -> bool:
    return bool(
        db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _SYNC_LOCK_KEY}).scalar_one()
    )


def release_sync_lock(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _SYNC_LOCK_KEY})
    db.commit()


def get_case_by_source_key(db: Session, source_case_key: str) -> FraudCase | None:
    stmt = select(FraudCase).where(FraudCase.source_case_key == source_case_key).limit(1)
    return db.execute(stmt).scalars().first()


def get_case_by_content_hash(db: Session, content_hash: str) -> FraudCase | None:
    stmt = select(FraudCase).where(FraudCase.content_hash == content_hash).limit(1)
    return db.execute(stmt).scalars().first()


def save_case(db: Session, row: FraudCase) -> FraudCase:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_stale_article_level_cases(
    db: Session,
    *,
    source_article_url: str,
    source_article_title: str,
    keep_source_keys: Sequence[str],
) -> int:
    stmt = (
        select(FraudCase)
        .where(FraudCase.source_article_url == source_article_url)
        .where(FraudCase.title == source_article_title)
        .where(FraudCase.knowledge_source_id.is_(None))
    )
    if keep_source_keys:
        stmt = stmt.where(FraudCase.source_case_key.not_in(list(keep_source_keys)))

    rows = list(db.execute(stmt).scalars().all())
    deleted = 0
    for row in rows:
        db.delete(row)
        deleted += 1
    if deleted:
        db.commit()
    return deleted


def get_case(db: Session, case_id: uuid.UUID) -> FraudCase | None:
    ensure_case_review_schema(db)
    return db.get(FraudCase, case_id)


def list_published_cases(db: Session) -> list[FraudCase]:
    ensure_case_review_schema(db)
    stmt = (
        select(FraudCase)
        .where(FraudCase.status == "published")
        .order_by(
            FraudCase.cover_url.is_not(None).desc(),
            FraudCase.is_featured.desc(),
            FraudCase.source_published_at.desc().nullslast(),
            FraudCase.published_at.desc(),
            FraudCase.created_at.desc(),
            FraudCase.id.desc(),
        )
    )
    return list(db.execute(stmt).scalars().all())


def list_cases(
    db: Session,
    *,
    page: int,
    limit: int,
    category: str | None,
    topic: str | None,
    sort: str,
) -> tuple[list[FraudCase], int]:
    ensure_case_review_schema(db)
    filters = [FraudCase.status == "published"]
    if category:
        filters.append(FraudCase.fraud_type == category)
    if topic:
        filters.append(FraudCase.tags.contains([topic]))

    total_stmt = select(func.count()).select_from(FraudCase).where(*filters)
    total = int(db.execute(total_stmt).scalar_one())

    stmt = select(FraudCase).where(*filters)
    if sort == "featured":
        stmt = stmt.order_by(
            FraudCase.cover_url.is_not(None).desc(),
            FraudCase.is_featured.desc(),
            FraudCase.source_published_at.desc().nullslast(),
            FraudCase.published_at.desc(),
            FraudCase.created_at.desc(),
            FraudCase.id.desc(),
        )
    else:
        stmt = stmt.order_by(
            FraudCase.cover_url.is_not(None).desc(),
            FraudCase.source_published_at.desc().nullslast(),
            FraudCase.published_at.desc(),
            FraudCase.created_at.desc(),
            FraudCase.id.desc(),
        )

    stmt = stmt.offset((page - 1) * limit).limit(limit)
    items = list(db.execute(stmt).scalars().all())
    return items, total


def list_admin_cases(
    db: Session,
    *,
    review_status: str | None,
    search: str | None,
    limit: int,
) -> list[FraudCase]:
    ensure_case_review_schema(db)
    stmt = select(FraudCase)
    if review_status:
        stmt = stmt.where(FraudCase.review_status == review_status)
    if search:
        keyword = f"%{search.strip()}%"
        stmt = stmt.where(
            FraudCase.title.ilike(keyword)
            | FraudCase.summary.ilike(keyword)
            | FraudCase.source_name.ilike(keyword)
            | FraudCase.source_article_title.ilike(keyword)
        )
    stmt = stmt.order_by(
        FraudCase.reviewed_at.desc().nullslast(),
        FraudCase.source_published_at.desc().nullslast(),
        FraudCase.updated_at.desc(),
        FraudCase.created_at.desc(),
    )
    stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def list_categories(db: Session) -> list[str]:
    ensure_case_review_schema(db)
    stmt = (
        select(FraudCase.fraud_type)
        .where(FraudCase.status == "published")
        .where(FraudCase.fraud_type.is_not(None))
        .distinct()
        .order_by(FraudCase.fraud_type.asc())
    )
    rows = db.execute(stmt).scalars().all()
    return [row for row in rows if row]


def list_related_cases(
    db: Session,
    *,
    current_id: uuid.UUID,
    fraud_type: str | None,
    limit: int,
) -> list[FraudCase]:
    ensure_case_review_schema(db)
    stmt = select(FraudCase).where(FraudCase.status == "published").where(FraudCase.id != current_id)
    if fraud_type:
        stmt = stmt.where(FraudCase.fraud_type == fraud_type)
    stmt = stmt.order_by(
        FraudCase.is_featured.desc(),
        FraudCase.source_published_at.desc().nullslast(),
        FraudCase.published_at.desc(),
    ).limit(limit)
    return list(db.execute(stmt).scalars().all())


def create_sync_run(
    db: Session,
    *,
    source_name: str,
    status: str,
    detail: dict | None = None,
) -> FraudCaseSyncRun:
    row = FraudCaseSyncRun(
        source_name=source_name,
        status=status,
        detail=detail or {},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_sync_run(db: Session, row: FraudCaseSyncRun) -> FraudCaseSyncRun:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_latest_sync_run(db: Session) -> FraudCaseSyncRun | None:
    stmt = select(FraudCaseSyncRun).order_by(FraudCaseSyncRun.created_at.desc()).limit(1)
    return db.execute(stmt).scalars().first()


def touch_related_fields(case: FraudCase, *, values: dict[str, object]) -> bool:
    changed = False
    for field, value in values.items():
        if getattr(case, field) != value:
            setattr(case, field, value)
            changed = True
    return changed


def count_cases_by_ids(db: Session, ids: Sequence[uuid.UUID]) -> int:
    ensure_case_review_schema(db)
    if not ids:
        return 0
    stmt = select(func.count()).select_from(FraudCase).where(FraudCase.id.in_(list(ids)))
    return int(db.execute(stmt).scalar_one())


def count_case_review_stats(db: Session) -> dict[str, int]:
    ensure_case_review_schema(db)
    return {
        "case_total": int(db.execute(select(func.count()).select_from(FraudCase)).scalar_one()),
        "case_pending": int(
            db.execute(
                select(func.count())
                .select_from(FraudCase)
                .where(FraudCase.review_status == "pending")
            ).scalar_one()
        ),
        "case_approved": int(
            db.execute(
                select(func.count())
                .select_from(FraudCase)
                .where(FraudCase.review_status == "approved")
            ).scalar_one()
        ),
        "case_rejected": int(
            db.execute(
                select(func.count())
                .select_from(FraudCase)
                .where(FraudCase.review_status == "rejected")
            ).scalar_one()
        ),
        "case_published": int(
            db.execute(
                select(func.count())
                .select_from(FraudCase)
                .where(FraudCase.status == "published")
            ).scalar_one()
        ),
    }


def clear_knowledge_source_reference(db: Session, *, source_id: int) -> int:
    ensure_case_review_schema(db)
    stmt = select(FraudCase).where(FraudCase.knowledge_source_id == int(source_id))
    rows = list(db.execute(stmt).scalars().all())
    updated = 0
    for row in rows:
        row.knowledge_source_id = None
        db.add(row)
        updated += 1
    if updated:
        db.commit()
    return updated
