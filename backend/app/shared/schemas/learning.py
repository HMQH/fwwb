"""学习模块 Schema。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class LearningTopicResponse(BaseModel):
    key: str
    label: str
    description: str
    simulation_persona: str
    count: int
    quiz_count: int


class LearningTopicsOverviewResponse(BaseModel):
    topics: list[LearningTopicResponse] = Field(default_factory=list)
    current_topic: LearningTopicResponse


class LearningCaseCategoryResponse(BaseModel):
    key: str
    label: str
    count: int


class LearningCaseFeedItemResponse(BaseModel):
    id: str
    title: str
    summary: str | None = None
    source_name: str
    fraud_type: str | None = None
    topic_key: str
    topic_label: str
    cover_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    source_article_url: str
    source_published_at: datetime | None = None
    published_at: datetime


class LearningCasesFeedResponse(BaseModel):
    categories: list[LearningCaseCategoryResponse] = Field(default_factory=list)
    current_category: str
    total: int
    last_sync_at: datetime | None = None
    items: list[LearningCaseFeedItemResponse] = Field(default_factory=list)


class LearningQuizOptionResponse(BaseModel):
    id: str
    text: str


class LearningQuizQuestionResponse(BaseModel):
    id: str
    type: str
    topic_key: str
    topic_label: str
    stem: str
    options: list[LearningQuizOptionResponse] = Field(default_factory=list)
    answer_id: str
    explanation: str
    source_case_id: str | None = None
    source_case_title: str | None = None
    source_case_summary: str | None = None


class LearningQuizSetResponse(BaseModel):
    topic_key: str
    topic_label: str
    generated_at: datetime
    questions: list[LearningQuizQuestionResponse] = Field(default_factory=list)


class LearningSimulationStartRequest(BaseModel):
    topic_key: str
    user_role: str | None = None


class LearningSimulationReplyRequest(BaseModel):
    message: str


class LearningSimulationMessageResponse(BaseModel):
    role: str
    content: str
    created_at: datetime


class LearningSimulationScenarioResponse(BaseModel):
    title: str
    summary: str
    channel: str
    hook: str
    tags: list[str] = Field(default_factory=list)
    source_case_id: str | None = None
    source_case_title: str | None = None


class LearningSimulationSessionResponse(BaseModel):
    session_id: str
    topic_key: str
    topic_label: str
    persona_label: str
    created_at: datetime
    scenario: LearningSimulationScenarioResponse
    messages: list[LearningSimulationMessageResponse] = Field(default_factory=list)


class LearningSimulationReplyResponse(BaseModel):
    session_id: str
    assistant_message: LearningSimulationMessageResponse


class LearningSimulationDimensionResponse(BaseModel):
    key: str
    label: str
    score: int


class LearningRelatedCaseResponse(BaseModel):
    id: str
    title: str
    summary: str | None = None
    source_name: str
    fraud_type: str | None = None
    topic_key: str
    topic_label: str
    source_article_url: str
    source_published_at: datetime | None = None
    published_at: datetime


class LearningSimulationResultResponse(BaseModel):
    session_id: str
    topic_key: str
    topic_label: str
    total_score: int
    summary: str
    suggestions: list[str] = Field(default_factory=list)
    dimensions: list[LearningSimulationDimensionResponse] = Field(default_factory=list)
    related_cases: list[LearningRelatedCaseResponse] = Field(default_factory=list)
