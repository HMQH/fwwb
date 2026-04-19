from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.home_watering import service as home_watering_service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.home_watering import (
    WateringRewardClaimRequest,
    WateringRewardClaimResponse,
    WateringRewardGrantRequest,
    WateringRewardGrantResponse,
    WateringStatusResponse,
)

router = APIRouter(prefix="/api/home/watering", tags=["home_watering"])


@router.get("/status", response_model=WateringStatusResponse)
def get_watering_status(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> WateringStatusResponse:
    payload = home_watering_service.get_watering_status(db, user_id=current.id)
    return WateringStatusResponse.model_validate(payload)


@router.post("/rewards", response_model=WateringRewardGrantResponse)
def grant_watering_reward(
    body: WateringRewardGrantRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> WateringRewardGrantResponse:
    payload = home_watering_service.grant_reward(
        db,
        user_id=current.id,
        source=body.source,
        units=body.units,
        dedupe_key=body.dedupe_key,
        payload=body.payload,
    )
    return WateringRewardGrantResponse.model_validate(payload)


@router.post("/claim", response_model=WateringRewardClaimResponse)
def claim_watering_rewards(
    body: WateringRewardClaimRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> WateringRewardClaimResponse:
    payload = home_watering_service.claim_rewards(
        db,
        user_id=current.id,
        limit=body.limit,
    )
    return WateringRewardClaimResponse.model_validate(payload)
