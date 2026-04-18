"""反诈案例模块服务：用户端案例展示、管理员审核与定时同步。"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.cases import crawler, repository
from app.domain.cases.entity import FraudCase
from app.domain.library import service as library_service
from app.shared.core.config import settings
from app.shared.db.session import SessionLocal
from app.shared.fraud_taxonomy import (
    RECOMMENDED_CATEGORY_KEY,
    build_case_categories,
    case_matches_learning_topic,
    recommendation_score,
    resolve_learning_topic,
)

logger = logging.getLogger(__name__)

SYNC_SOURCE_NAME = "官方反诈案例聚合"
_scheduler_thread: threading.Thread | None = None
_scheduler_stop_event = threading.Event()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _extra_urls_from_settings() -> list[str]:
    raw = (settings.cases_sync_seed_urls or "").strip()
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def get_seed_urls() -> list[str]:
    return _extra_urls_from_settings()


def _build_case_content_hash(values: dict[str, Any]) -> str:
    payload = {
        "title": values.get("title"),
        "summary": values.get("summary"),
        "fraud_type": values.get("fraud_type"),
        "tags": list(values.get("tags") or []),
        "warning_signs": list(values.get("warning_signs") or []),
        "prevention_actions": list(values.get("prevention_actions") or []),
        "detail_blocks": list(values.get("detail_blocks") or []),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _case_to_payload(case: FraudCase) -> dict[str, Any]:
    topic = resolve_learning_topic(
        fraud_type=case.fraud_type,
        title=case.title,
        summary=case.summary,
        tags=case.tags,
    )
    return {
        "id": case.id,
        "source_name": case.source_name,
        "source_domain": case.source_domain,
        "source_article_title": case.source_article_title,
        "source_article_url": case.source_article_url,
        "title": case.title,
        "summary": case.summary,
        "content_type": case.content_type,
        "fraud_type": case.fraud_type,
        "topic_key": topic.key,
        "topic_label": topic.label,
        "cover_url": case.cover_url,
        "tags": list(case.tags or []),
        "target_roles": list(case.target_roles or []),
        "warning_signs": list(case.warning_signs or []),
        "prevention_actions": list(case.prevention_actions or []),
        "flow_nodes": list(case.flow_nodes or []),
        "media_assets": list(case.media_assets or []),
        "detail_blocks": list(case.detail_blocks or []),
        "source_published_at": case.source_published_at,
        "published_at": case.published_at,
        "last_synced_at": case.last_synced_at,
        "is_featured": case.is_featured,
        "status": case.status,
        "review_status": case.review_status,
        "review_note": case.review_note,
        "reviewed_by": case.reviewed_by,
        "reviewed_at": case.reviewed_at,
        "knowledge_source_id": case.knowledge_source_id,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
    }


def list_cases(
    db: Session,
    *,
    page: int,
    limit: int,
    category: str | None,
    topic: str | None = None,
    sort: str = "latest",
    recommend_for: str | None = None,
) -> dict[str, Any]:
    del topic, sort
    all_cases = repository.list_published_cases(db)
    selected_category = category or RECOMMENDED_CATEGORY_KEY
    categories = build_case_categories(all_cases)
    valid_keys = {item["key"] for item in categories}
    if selected_category not in valid_keys:
        selected_category = RECOMMENDED_CATEGORY_KEY

    if selected_category == RECOMMENDED_CATEGORY_KEY:
        filtered = list(all_cases)
        filtered.sort(
            key=lambda item: (
                recommendation_score(item, recommend_for),
                1 if item.cover_url else 0,
                item.source_published_at or item.published_at or item.created_at,
                item.created_at,
                str(item.id),
            ),
            reverse=True,
        )
    else:
        filtered = [item for item in all_cases if case_matches_learning_topic(item, selected_category)]
        filtered.sort(
            key=lambda item: (
                1 if item.cover_url else 0,
                item.source_published_at or item.published_at or item.created_at,
                item.created_at,
                str(item.id),
            ),
            reverse=True,
        )

    total = len(filtered)
    start = max(0, (page - 1) * limit)
    end = start + limit
    items = filtered[start:end]
    latest_sync = repository.get_latest_sync_run(db)
    return {
        "items": [_case_to_payload(item) for item in items],
        "page": page,
        "limit": limit,
        "total": total,
        "has_more": page * limit < total,
        "categories": categories,
        "last_sync_at": latest_sync.finished_at if latest_sync else None,
        "latest_sync": latest_sync,
    }


def list_admin_cases(
    db: Session,
    *,
    review_status: str | None,
    search: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    repository.ensure_case_review_schema(db)
    rows = repository.list_admin_cases(db, review_status=review_status, search=search, limit=limit)
    return [_case_to_payload(row) for row in rows]


def get_case_detail(db: Session, *, case_id: uuid.UUID) -> dict[str, Any]:
    case = repository.get_case(db, case_id)
    if case is None or case.status != "published":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案例不存在")

    related = repository.list_related_cases(
        db,
        current_id=case.id,
        fraud_type=case.fraud_type,
        limit=3,
    )
    payload = _case_to_payload(case)
    payload["related_cases"] = [_case_to_payload(item) for item in related]
    return payload


def get_admin_dashboard(db: Session) -> dict[str, Any]:
    repository.ensure_case_review_schema(db)
    latest_sync = repository.get_latest_sync_run(db)
    stats = repository.count_case_review_stats(db)
    stats["source_total"] = library_service.count_sources(db)
    pending_cases = list_admin_cases(db, review_status="pending", search=None, limit=5)
    return {
        "stats": stats,
        "latest_case_sync": _serialize_sync_run(latest_sync) if latest_sync else None,
        "seed_urls": get_seed_urls(),
        "official_sources": crawler.list_official_source_names(),
        "pending_cases": pending_cases,
    }


def _serialize_sync_run(sync_run: Any) -> dict[str, Any] | None:
    if sync_run is None:
        return None
    return {
        "id": sync_run.id,
        "source_name": sync_run.source_name,
        "status": sync_run.status,
        "discovered_count": sync_run.discovered_count,
        "inserted_count": sync_run.inserted_count,
        "updated_count": sync_run.updated_count,
        "skipped_count": sync_run.skipped_count,
        "error_message": sync_run.error_message,
        "detail": sync_run.detail or {},
        "started_at": sync_run.started_at,
        "finished_at": sync_run.finished_at,
        "created_at": sync_run.created_at,
        "updated_at": sync_run.updated_at,
    }


def _parsed_case_values(item: crawler.ParsedCase) -> dict[str, Any]:
    values = {
        "source_name": item.source_name,
        "source_domain": item.source_domain,
        "source_article_title": item.source_article_title,
        "source_article_url": item.source_article_url,
        "title": item.title,
        "summary": item.summary,
        "content_type": item.content_type,
        "fraud_type": item.fraud_type,
        "cover_url": item.cover_url,
        "tags": list(item.tags),
        "target_roles": list(item.target_roles),
        "warning_signs": list(item.warning_signs),
        "prevention_actions": list(item.prevention_actions),
        "flow_nodes": list(item.flow_nodes),
        "media_assets": list(item.media_assets),
        "detail_blocks": list(item.detail_blocks),
        "source_published_at": item.source_published_at,
        "published_at": item.published_at,
        "last_synced_at": _utcnow(),
        "is_featured": item.is_featured,
        "raw_payload": dict(item.raw_payload),
    }
    values["content_hash"] = _build_case_content_hash(values)
    return values


def sync_cases(
    db: Session,
    *,
    release_urls: list[str] | None = None,
) -> dict[str, Any]:
    repository.ensure_case_review_schema(db)
    if not repository.try_acquire_sync_lock(db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="案例同步任务正在运行")

    extra_urls = release_urls if release_urls is not None else _extra_urls_from_settings()
    sync_run = repository.create_sync_run(
        db,
        source_name=SYNC_SOURCE_NAME,
        status="running",
        detail={
            "official_sources": crawler.list_official_source_names(),
            "extra_urls": extra_urls,
        },
    )

    discovered_count = 0
    inserted_count = 0
    updated_count = 0
    skipped_count = 0

    try:
        sync_run.started_at = _utcnow()
        repository.save_sync_run(db, sync_run)

        parsed_items = crawler.crawl_cases(extra_article_urls=extra_urls)
        discovered_count = len(parsed_items)

        grouped_keys: dict[tuple[str, str], list[str]] = {}
        source_case_counts: dict[str, int] = {}
        for item in parsed_items:
            grouped_keys.setdefault(
                (item.source_article_url, item.source_article_title),
                [],
            ).append(item.source_case_key)
            source_case_counts[item.source_name] = source_case_counts.get(item.source_name, 0) + 1

        for item in parsed_items:
            values = _parsed_case_values(item)
            existing = repository.get_case_by_source_key(db, item.source_case_key)
            if existing is None:
                duplicate = repository.get_case_by_content_hash(db, values["content_hash"])
                if duplicate is not None:
                    skipped_count += 1
                    continue
                repository.save_case(
                    db,
                    FraudCase(
                        source_case_key=item.source_case_key,
                        status="draft",
                        review_status="pending",
                        review_note=None,
                        reviewed_by=None,
                        reviewed_at=None,
                        knowledge_source_id=None,
                        **values,
                    ),
                )
                inserted_count += 1
                continue

            changed = repository.touch_related_fields(existing, values=values)
            if changed:
                repository.save_case(db, existing)
                updated_count += 1
                if existing.review_status == "approved" and existing.status == "published":
                    try:
                        source_id, _ = library_service.sync_case_to_library(db, case=existing)
                        existing.knowledge_source_id = source_id
                        repository.save_case(db, existing)
                    except Exception:
                        logger.warning("已发布案例同步知识库失败：%s", existing.id, exc_info=True)
            else:
                skipped_count += 1

        for (article_url, article_title), keep_keys in grouped_keys.items():
            if len(keep_keys) <= 1:
                continue
            repository.delete_stale_article_level_cases(
                db,
                source_article_url=article_url,
                source_article_title=article_title,
                keep_source_keys=keep_keys,
            )

        sync_run.status = "completed"
        sync_run.discovered_count = discovered_count
        sync_run.inserted_count = inserted_count
        sync_run.updated_count = updated_count
        sync_run.skipped_count = skipped_count
        sync_run.finished_at = _utcnow()
        sync_run.error_message = None
        sync_run.detail = {
            "official_sources": crawler.list_official_source_names(),
            "extra_urls": extra_urls,
            "source_case_counts": source_case_counts,
            "case_count": discovered_count,
            "pending_count": repository.count_case_review_stats(db).get("case_pending", 0),
        }
        repository.save_sync_run(db, sync_run)
        return {
            "sync_run": sync_run,
            "discovered_count": discovered_count,
            "inserted_count": inserted_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("案例同步失败")
        sync_run.status = "failed"
        sync_run.error_message = str(exc)
        sync_run.discovered_count = discovered_count
        sync_run.inserted_count = inserted_count
        sync_run.updated_count = updated_count
        sync_run.skipped_count = skipped_count
        sync_run.finished_at = _utcnow()
        repository.save_sync_run(db, sync_run)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="案例同步失败") from exc
    finally:
        repository.release_sync_lock(db)


def review_case(
    db: Session,
    *,
    case_id: uuid.UUID,
    action: str,
    note: str | None,
    actor: str,
) -> dict[str, Any]:
    repository.ensure_case_review_schema(db)
    case = repository.get_case(db, case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案例不存在")

    if action == "approve":
        source_id, job_ids = library_service.sync_case_to_library(db, case=case)
        case.knowledge_source_id = source_id
        case.review_status = "approved"
        case.status = "published"
        case.review_note = note
        case.reviewed_by = actor
        case.reviewed_at = _utcnow()
        case.published_at = _utcnow()
        repository.save_case(db, case)
        payload = _case_to_payload(case)
        payload["rag_job_ids"] = job_ids
        return payload

    if action == "reject":
        library_service.remove_case_from_library(db, case=case)
        case.review_status = "rejected"
        case.status = "archived"
        case.review_note = note
        case.reviewed_by = actor
        case.reviewed_at = _utcnow()
        repository.save_case(db, case)
        return _case_to_payload(case)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的审核动作")


def get_latest_sync_run(db: Session):
    return repository.get_latest_sync_run(db)


def sync_cases_in_new_session() -> None:
    db = SessionLocal()
    try:
        sync_cases(db)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            logger.warning("案例定时同步失败：%s", exc.detail)
    except Exception:  # noqa: BLE001
        logger.exception("案例定时同步异常")
    finally:
        db.close()


def _scheduler_loop() -> None:
    initial_delay = max(5, settings.cases_sync_initial_delay_seconds)
    if _scheduler_stop_event.wait(initial_delay):
        return

    while not _scheduler_stop_event.is_set():
        sync_cases_in_new_session()
        interval = max(15, settings.cases_sync_interval_minutes * 60)
        if _scheduler_stop_event.wait(interval):
            return


def start_sync_scheduler() -> None:
    global _scheduler_thread
    if not settings.cases_sync_enabled:
        return
    if _scheduler_thread and _scheduler_thread.is_alive():
        return

    _scheduler_stop_event.clear()
    _scheduler_thread = threading.Thread(
        target=_scheduler_loop,
        name="fraud-case-sync-scheduler",
        daemon=True,
    )
    _scheduler_thread.start()


def stop_sync_scheduler() -> None:
    _scheduler_stop_event.set()
