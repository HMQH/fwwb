"""RAG job management routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.rag import service as rag_service
from app.domain.user.entity import User
from app.shared.db.session import get_db
from app.shared.schemas.rag import RagBackfillRequest, RagJobResponse

router = APIRouter(prefix="/api/rag", tags=["rag"])


@router.post("/jobs/backfill", response_model=RagJobResponse, status_code=status.HTTP_201_CREATED)
def create_backfill_job(
    body: RagBackfillRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> RagJobResponse:
    job = rag_service.create_backfill_job(
        db,
        source_ids=body.source_ids,
        source_id_min=body.source_id_min,
        source_id_max=body.source_id_max,
        data_sources=body.data_sources,
        force=body.force,
        limit=body.limit,
    )
    if body.run_in_background:
        background_tasks.add_task(rag_service.process_job_in_new_session, job.id)
    return RagJobResponse.model_validate(job)


@router.get("/jobs", response_model=list[RagJobResponse])
def list_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> list[RagJobResponse]:
    jobs = rag_service.list_jobs(db, limit=limit)
    return [RagJobResponse.model_validate(job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=RagJobResponse)
def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> RagJobResponse:
    job = rag_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG job not found")
    return RagJobResponse.model_validate(job)


@router.post("/jobs/{job_id}/run", response_model=RagJobResponse)
def run_job(
    job_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _current: User = Depends(get_current_user),
) -> RagJobResponse:
    job = rag_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG job not found")
    if job.status != "running":
        background_tasks.add_task(rag_service.process_job_in_new_session, job.id)
    return RagJobResponse.model_validate(job)

