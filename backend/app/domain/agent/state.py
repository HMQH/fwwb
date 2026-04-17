from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    db_session: Any
    submission_id: str
    reasoning_goal: str | None
    vision_plan: dict[str, Any]
    text_content: str | None
    image_paths: list[str]
    audio_paths: list[str]
    video_paths: list[str]
    text_rag_input: str | None
    unsupported_modalities: list[str]
    selected_skills: list[str]
    routing_notes: list[str]
    planner_notes: list[str]
    execution_plan: list[dict[str, Any]]
    pending_actions: list[str]
    completed_actions: list[str]
    execution_trace: list[dict[str, Any]]
    action_instance_counter: int
    iteration_count: int
    max_iterations: int
    next_action: str
    last_action: str | None
    requires_followup: bool
    followup_actions: list[str]
    stop_reason: str | None
    qr_result: dict[str, Any]
    ocr_result: dict[str, Any]
    pii_result: dict[str, Any]
    official_document_result: dict[str, Any]
    impersonation_result: dict[str, Any]
    text_rag_result: dict[str, Any]
    image_similarity_result: dict[str, Any]
    document_review_result: dict[str, Any]
    conflict_resolution_result: dict[str, Any]
    summary_result: dict[str, Any]
