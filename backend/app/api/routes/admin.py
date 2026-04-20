"""管理员端核心接口：概览、知识库管理、案例审核、反馈占位。"""
from __future__ import annotations

from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.domain.admin import service as admin_service
from app.domain.cases import service as cases_service
from app.domain.library import service as library_service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.admin import (
    AdminCaseListResponse,
    AdminDashboardResponse,
    AdminFeedbackListResponse,
    AdminSourceListResponse,
    CaseBatchApproveRequest,
    CaseReviewRequest,
    CaseSyncRequest,
    SourceImportTextRequest,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard", response_model=AdminDashboardResponse)
def get_dashboard(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> AdminDashboardResponse:
    _ = current
    return AdminDashboardResponse.model_validate(cases_service.get_admin_dashboard(db))


@router.get("/analytics/overview")
def get_analytics_overview(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    _ = current
    return admin_service.get_analytics_overview(db)


@router.post("/cases/sync")
def sync_cases(
    body: CaseSyncRequest | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    payload = cases_service.sync_cases(db, release_urls=body.urls if body else None)
    return {
        "sync_run": cases_service.get_admin_dashboard(db).get("latest_case_sync"),
        "discovered_count": payload["discovered_count"],
        "inserted_count": payload["inserted_count"],
        "updated_count": payload["updated_count"],
        "skipped_count": payload["skipped_count"],
        "operator": current.display_name,
    }


@router.post("/knowledge/sync")
def sync_cases_legacy(
    body: CaseSyncRequest | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    return sync_cases(body=body, db=db, current=current)


@router.get("/cases", response_model=AdminCaseListResponse)
def list_cases(
    review_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=60, ge=1, le=500),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> AdminCaseListResponse:
    _ = current
    return AdminCaseListResponse(
        items=cases_service.list_admin_cases(
            db,
            review_status=review_status,
            search=search,
            limit=limit,
        )
    )


@router.post("/cases/{case_id}/review")
def review_case(
    case_id: uuid.UUID,
    body: CaseReviewRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    item = cases_service.review_case(
        db,
        case_id=case_id,
        action=body.action,
        note=body.note,
        actor=current.display_name,
    )
    return {"item": item}


@router.post("/cases/review-all")
def review_all_cases(
    body: CaseBatchApproveRequest | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    return cases_service.approve_all_pending_cases(
        db,
        actor=current.display_name,
        note=body.note if body else None,
    )


@router.get("/library/sources", response_model=AdminSourceListResponse)
def list_sources(
    search: str | None = Query(default=None),
    sample_label: str | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> AdminSourceListResponse:
    _ = current
    return AdminSourceListResponse(
        items=library_service.list_sources(db, search=search, sample_label=sample_label, limit=limit)
    )


@router.delete("/library/sources/{source_id}")
def delete_source(
    source_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    _ = current
    library_service.delete_source(db, source_id=source_id)
    return {"ok": True}


@router.post("/library/sources/import-text")
def import_text_source(
    body: SourceImportTextRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    _ = current
    return library_service.import_text_source(
        db,
        title=body.title,
        content=body.content,
        sample_label=body.sample_label,
        fraud_type=body.fraud_type,
        url=body.url,
        data_source=body.data_source,
    )


@router.post("/library/sources/import-file")
async def import_file_source(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    sample_label: str = Form(default="white"),
    fraud_type: str | None = Form(default=None),
    url: str | None = Form(default=None),
    data_source: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> dict:
    _ = current
    data = await file.read()
    _suffix, content = library_service.decode_upload_content(file.filename, data)
    import_title = title or Path(file.filename or "").stem or "导入资料"
    return library_service.import_text_source(
        db,
        title=import_title,
        content=content,
        sample_label=sample_label if sample_label in {"black", "white"} else "white",
        fraud_type=fraud_type,
        url=url,
        data_source=data_source or "admin_upload_file",
    )


@router.get("/feedback", response_model=AdminFeedbackListResponse)
def list_feedback(
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_admin),
) -> AdminFeedbackListResponse:
    _ = current
    return AdminFeedbackListResponse(items=admin_service.list_feedback(db, limit=limit))
