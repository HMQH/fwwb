from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.guardians import service as guardian_service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.guardians import (
    CreateGuardianBindingRequest,
    CreateGuardianEventsRequest,
    CreateGuardianInterventionRequest,
    GuardianBindingResponse,
    GuardianEventResponse,
)

router = APIRouter(prefix="/api/guardians", tags=["guardians"])


@router.get("/bindings", response_model=list[GuardianBindingResponse])
def list_bindings(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[GuardianBindingResponse]:
    items = guardian_service.list_bindings(db, current_user=current)
    return [GuardianBindingResponse.model_validate(item) for item in items]


@router.post("/bindings", response_model=GuardianBindingResponse, status_code=status.HTTP_201_CREATED)
def create_binding(
    body: CreateGuardianBindingRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianBindingResponse:
    item = guardian_service.create_binding(
        db,
        current_user=current,
        guardian_phone=body.guardian_phone,
        guardian_name=body.guardian_name,
        relation=body.relation,
        consent_scope=body.consent_scope,
        is_primary=body.is_primary,
    )
    return GuardianBindingResponse.model_validate(item)


@router.post("/bindings/{binding_id}/confirm", response_model=GuardianBindingResponse)
def confirm_binding(
    binding_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianBindingResponse:
    item = guardian_service.confirm_binding(db, current_user=current, binding_id=binding_id)
    return GuardianBindingResponse.model_validate(item)


@router.post("/bindings/{binding_id}/revoke", response_model=GuardianBindingResponse)
def revoke_binding(
    binding_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianBindingResponse:
    item = guardian_service.revoke_binding(db, current_user=current, binding_id=binding_id)
    return GuardianBindingResponse.model_validate(item)


@router.get("/events", response_model=list[GuardianEventResponse])
def list_events(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[GuardianEventResponse]:
    items = guardian_service.list_events(db, current_user=current, limit=limit)
    return [GuardianEventResponse.model_validate(item) for item in items]


@router.post("/events", response_model=list[GuardianEventResponse])
def create_events(
    body: CreateGuardianEventsRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[GuardianEventResponse]:
    items = guardian_service.create_events_from_submission(
        db,
        current_user=current,
        submission_id=body.submission_id,
    )
    return [GuardianEventResponse.model_validate(item) for item in items]


@router.get("/events/{event_id}", response_model=GuardianEventResponse)
def get_event_detail(
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianEventResponse:
    item = guardian_service.get_event_detail(db, current_user=current, event_id=event_id)
    return GuardianEventResponse.model_validate(item)


@router.post("/events/{event_id}/actions", response_model=GuardianEventResponse)
def create_intervention(
    event_id: uuid.UUID,
    body: CreateGuardianInterventionRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> GuardianEventResponse:
    item = guardian_service.create_intervention(
        db,
        current_user=current,
        event_id=event_id,
        action_type=body.action_type,
        note=body.note,
        payload=body.payload,
    )
    return GuardianEventResponse.model_validate(item)
