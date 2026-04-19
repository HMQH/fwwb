from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

WateringRewardSource = Literal["quiz", "guardian", "case"]


class WateringRewardEventResponse(BaseModel):
    id: UUID
    source: WateringRewardSource
    units: int
    created_at: datetime


class WateringRewardGrantRequest(BaseModel):
    source: WateringRewardSource
    units: int = Field(default=1, ge=1, le=5)
    dedupe_key: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any] | None = None


class WateringRewardGrantResponse(BaseModel):
    created: bool
    event: WateringRewardEventResponse
    pending_count: int
    pending_units: int


class WateringRewardClaimRequest(BaseModel):
    limit: int = Field(default=64, ge=1, le=120)


class WateringRewardClaimResponse(BaseModel):
    events: list[WateringRewardEventResponse] = Field(default_factory=list)
    claimed_units: int
    water_total: int
    pending_count: int
    pending_units: int


class WateringStatusResponse(BaseModel):
    water_total: int
    pending_count: int
    pending_units: int
