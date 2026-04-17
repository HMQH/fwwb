from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.domain.agent.graph import get_detection_graph
from app.domain.detection.entity import DetectionSubmission
from app.shared.core.config import settings
from app.shared.observability.langsmith import traceable, tracing_session
from app.shared.storage.upload_paths import resolved_upload_root


def _absolute_upload_path(relative_path: str) -> str:
    root = resolved_upload_root(settings.upload_root)
    return str((root / Path(relative_path)).resolve())


def _serialize_detail(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "reasoning_goal": state.get("reasoning_goal"),
        "vision_plan": state.get("vision_plan"),
        "selected_skills": state.get("selected_skills", []),
        "routing_notes": state.get("routing_notes", []),
        "planner_notes": state.get("planner_notes", []),
        "unsupported_modalities": state.get("unsupported_modalities", []),
        "execution_plan": state.get("execution_plan", []),
        "pending_actions": state.get("pending_actions", []),
        "completed_actions": state.get("completed_actions", []),
        "execution_trace": state.get("execution_trace", []),
        "action_instance_counter": state.get("action_instance_counter"),
        "iteration_count": state.get("iteration_count"),
        "max_iterations": state.get("max_iterations"),
        "requires_followup": state.get("requires_followup", False),
        "followup_actions": state.get("followup_actions", []),
        "stop_reason": state.get("stop_reason"),
        "text_rag_input": state.get("text_rag_input"),
        "qr_result": state.get("qr_result"),
        "ocr_result": state.get("ocr_result"),
        "pii_result": state.get("pii_result"),
        "official_document_result": state.get("official_document_result"),
        "impersonation_result": state.get("impersonation_result"),
        "text_rag_result": state.get("text_rag_result"),
        "image_similarity_result": state.get("image_similarity_result"),
        "document_review_result": state.get("document_review_result"),
        "conflict_resolution_result": state.get("conflict_resolution_result"),
    }


@traceable(name="agent.analyze_submission", run_type="chain")
def analyze_submission(*, db: Session, submission: DetectionSubmission) -> dict[str, Any]:
    graph = get_detection_graph()
    initial_state = {
        "db_session": db,
        "submission_id": str(submission.id),
        "text_content": submission.text_content,
        "image_paths": [_absolute_upload_path(path) for path in submission.image_paths],
        "audio_paths": list(submission.audio_paths),
        "video_paths": list(submission.video_paths),
        "max_iterations": settings.agent_max_iterations,
        "action_instance_counter": 0,
    }
    with tracing_session():
        final_state = graph.invoke(initial_state)
    summary = dict(final_state.get("summary_result") or {})
    summary.setdefault("status", "completed")
    result_detail = summary.get("result_detail")
    if not isinstance(result_detail, dict):
        result_detail = {}
    result_detail.update(_serialize_detail(final_state))
    summary["result_detail"] = result_detail
    return summary
