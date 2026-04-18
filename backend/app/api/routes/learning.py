"""反诈学习模块路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.domain.learning import service as learning_service
from app.shared.db.session import get_db
from app.shared.schemas.learning import (
    LearningCasesFeedResponse,
    LearningQuizSetResponse,
    LearningSimulationReplyRequest,
    LearningSimulationReplyResponse,
    LearningSimulationResultResponse,
    LearningSimulationSessionResponse,
    LearningSimulationStartRequest,
    LearningTopicsOverviewResponse,
)

router = APIRouter(prefix="/api/learning", tags=["learning"])


@router.get("/topics", response_model=LearningTopicsOverviewResponse)
def get_learning_topics(
    topic: str | None = Query(default=None),
    role: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> LearningTopicsOverviewResponse:
    payload = learning_service.list_learning_topics_overview(db, topic_key=topic, role=role)
    return LearningTopicsOverviewResponse.model_validate(payload)


@router.get("/cases", response_model=LearningCasesFeedResponse)
def get_learning_cases(
    category: str | None = Query(default=None),
    role: str | None = Query(default=None),
    limit: int = Query(default=12, ge=4, le=20),
    db: Session = Depends(get_db),
) -> LearningCasesFeedResponse:
    payload = learning_service.list_learning_cases(db, category=category, role=role, limit=limit)
    return LearningCasesFeedResponse.model_validate(payload)


@router.get("/quizzes", response_model=LearningQuizSetResponse)
def get_quiz_set(
    topic: str = Query(...),
    count: int = Query(default=5, ge=3, le=10),
    role: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> LearningQuizSetResponse:
    payload = learning_service.get_quiz_set(db, topic_key=topic, count=count, role=role)
    return LearningQuizSetResponse.model_validate(payload)


@router.post("/simulations", response_model=LearningSimulationSessionResponse)
def start_simulation(
    body: LearningSimulationStartRequest,
    db: Session = Depends(get_db),
) -> LearningSimulationSessionResponse:
    payload = learning_service.start_simulation(db, topic_key=body.topic_key, user_role=body.user_role)
    return LearningSimulationSessionResponse.model_validate(payload)


@router.post("/simulations/{session_id}/reply", response_model=LearningSimulationReplyResponse)
def send_simulation_reply(
    session_id: str,
    body: LearningSimulationReplyRequest,
) -> LearningSimulationReplyResponse:
    payload = learning_service.send_simulation_reply(session_id=session_id, message=body.message)
    return LearningSimulationReplyResponse.model_validate(payload)


@router.post("/simulations/{session_id}/finish", response_model=LearningSimulationResultResponse)
def finish_simulation(
    session_id: str,
    db: Session = Depends(get_db),
) -> LearningSimulationResultResponse:
    payload = learning_service.finish_simulation(db, session_id=session_id)
    return LearningSimulationResultResponse.model_validate(payload)
