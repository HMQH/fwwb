from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.guardian_reports import service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.guardian_reports import (
    GenerateGuardianReportRequest,
    GuardianSafetyReportDetailResponse,
    GuardianSafetyReportListItemResponse,
    GuardianReportType,
    UpdateGuardianReportActionStatusRequest,
)

router = APIRouter(prefix="/api/guardians/reports", tags=["guardian_reports"])


@router.post("/generate", response_model=GuardianSafetyReportDetailResponse, status_code=status.HTTP_201_CREATED)
def generate_report(
    body: GenerateGuardianReportRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianSafetyReportDetailResponse:
    detail = service.generate_report(
        db,
        current_user=current,
        report_type=body.report_type,
        ward_user_id=body.ward_user_id,
        target_date=body.target_date,
        force_regenerate=body.force_regenerate,
    )
    return GuardianSafetyReportDetailResponse.model_validate(detail)


@router.get("", response_model=list[GuardianSafetyReportListItemResponse])
def list_reports(
    report_type: GuardianReportType | None = Query(default=None),
    ward_user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[GuardianSafetyReportListItemResponse]:
    items = service.list_reports(
        db,
        current_user=current,
        report_type=report_type,
        ward_user_id=ward_user_id,
        limit=limit,
        offset=offset,
    )
    return [GuardianSafetyReportListItemResponse.model_validate(item) for item in items]


@router.get("/{report_id}", response_model=GuardianSafetyReportDetailResponse)
def get_report_detail(
    report_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianSafetyReportDetailResponse:
    detail = service.get_report_detail(
        db,
        current_user=current,
        report_id=report_id,
    )
    return GuardianSafetyReportDetailResponse.model_validate(detail)


@router.post("/{report_id}/read", response_model=GuardianSafetyReportDetailResponse)
def mark_report_read(
    report_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianSafetyReportDetailResponse:
    detail = service.mark_report_read(
        db,
        current_user=current,
        report_id=report_id,
    )
    return GuardianSafetyReportDetailResponse.model_validate(detail)


@router.post("/{report_id}/actions/{action_id}", response_model=GuardianSafetyReportDetailResponse)
def update_report_action_status(
    report_id: uuid.UUID,
    action_id: uuid.UUID,
    body: UpdateGuardianReportActionStatusRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianSafetyReportDetailResponse:
    detail = service.update_action_status(
        db,
        current_user=current,
        report_id=report_id,
        action_id=action_id,
        status_value=body.status,
    )
    return GuardianSafetyReportDetailResponse.model_validate(detail)
