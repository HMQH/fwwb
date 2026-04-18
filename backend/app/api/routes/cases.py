"""反诈案例模块路由。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.domain.cases import service as cases_service
from app.shared.db.session import get_db
from app.shared.schemas.cases import (
    FraudCaseDetailResponse,
    FraudCaseListResponse,
    FraudCaseSyncResponse,
    FraudCaseSyncRunResponse,
)

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("", response_model=FraudCaseListResponse)
def list_cases(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=20),
    category: str | None = Query(default=None),
    topic: str | None = Query(default=None),
    sort: str = Query(default="latest"),
    role: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> FraudCaseListResponse:
    payload = cases_service.list_cases(
        db,
        page=page,
        limit=limit,
        category=category,
        topic=topic,
        sort=sort,
        recommend_for=role,
    )
    return FraudCaseListResponse.model_validate(payload)


@router.get("/sync/latest", response_model=FraudCaseSyncRunResponse | None)
def get_latest_sync_run(db: Session = Depends(get_db)) -> FraudCaseSyncRunResponse | None:
    latest = cases_service.get_latest_sync_run(db)
    if latest is None:
        return None
    return FraudCaseSyncRunResponse.model_validate(latest)


@router.post("/sync", response_model=FraudCaseSyncResponse)
def sync_cases(db: Session = Depends(get_db)) -> FraudCaseSyncResponse:
    payload = cases_service.sync_cases(db)
    return FraudCaseSyncResponse.model_validate(payload)


@router.get("/{case_id}", response_model=FraudCaseDetailResponse)
def get_case_detail(
    case_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> FraudCaseDetailResponse:
    payload = cases_service.get_case_detail(db, case_id=case_id)
    return FraudCaseDetailResponse.model_validate(payload)
