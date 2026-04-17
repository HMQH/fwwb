from __future__ import annotations

from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.supervisor import run_supervisor
from app.shared.core.config import settings
from app.shared.observability.langsmith import traceable


INITIAL_ACTION_ORDER = [
    "qr_inspector",
    "ocr_phishing",
    "official_document_checker",
    "pii_guard",
    "impersonation_checker",
    "text_rag_skill",
]
FOLLOWUP_ACTIONS = [
    "image_similarity_verifier",
    "document_review",
    "conflict_resolver",
]


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for item in items:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        merged.append(value)
    return merged


def _build_execution_plan(
    *,
    selected_skills: list[str],
    pending_actions: list[str],
    completed_actions: list[str],
    followup_actions: list[str],
) -> list[dict[str, Any]]:
    ordered = _unique(selected_skills + FOLLOWUP_ACTIONS + ["final_judge"])
    pending = set(pending_actions)
    completed = set(completed_actions)
    followups = set(followup_actions)
    plan: list[dict[str, Any]] = []
    for action in ordered:
        status = "pending"
        if action in completed:
            status = "completed"
        elif action in pending or action == "final_judge":
            status = "pending"
        plan.append(
            {
                "action": action,
                "phase": "followup" if action in FOLLOWUP_ACTIONS else "core",
                "status": status,
                "selected": action in selected_skills or action in followups or action == "final_judge",
            }
        )
    return plan


def _has_real_ocr_text(state: AgentState) -> bool:
    ocr_result = state.get("ocr_result") or {}
    if not isinstance(ocr_result, dict):
        return False
    raw = ocr_result.get("raw")
    if not isinstance(raw, dict):
        return False
    provider = str(raw.get("provider") or "").strip().lower()
    aggregated_text = str(raw.get("aggregated_text") or "").strip()
    return bool(
        provider
        and provider != "stub"
        and len(aggregated_text) >= max(1, int(settings.agent_text_rag_min_chars))
    )


def _direct_text_available(state: AgentState) -> bool:
    return bool(str(state.get("text_content") or "").strip())


def _should_queue_text_rag(
    state: AgentState,
    *,
    selected_skills: list[str],
    pending_actions: list[str],
    completed_actions: list[str],
) -> tuple[bool, str | None]:
    if "text_rag_skill" in pending_actions or "text_rag_skill" in completed_actions:
        return False, None

    has_image = bool(state.get("image_paths"))
    has_text = _direct_text_available(state)
    vision_plan = state.get("vision_plan") or {}
    if not isinstance(vision_plan, dict):
        vision_plan = {}
    wants_rag_after_ocr = bool(vision_plan.get("should_run_text_rag_after_ocr", True))
    has_real_ocr_text = _has_real_ocr_text(state)
    waits_for_ocr = has_image and "ocr_phishing" in selected_skills and "ocr_phishing" not in completed_actions

    if has_text and not has_image:
        return True, "检测到直接文本输入，进入文本 RAG。"

    if has_image:
        if waits_for_ocr:
            return False, None
        if has_text:
            return True, "已完成 OCR 阶段，进入文本 RAG 以合并用户文本和图中文字。"
        if has_real_ocr_text and wants_rag_after_ocr:
            return True, "OCR 提取到了足够文本，追加文本 RAG 做语义判断。"

    return False, None


@traceable(name="agent.planner", run_type="chain")
def run_planner(state: AgentState) -> AgentState:
    updates: AgentState = {}
    planner_notes = list(state.get("planner_notes") or [])
    selected_skills = list(state.get("selected_skills") or [])
    pending_actions = list(state.get("pending_actions") or [])
    completed_actions = list(state.get("completed_actions") or [])
    followup_actions = list(state.get("followup_actions") or [])
    execution_trace = list(state.get("execution_trace") or [])
    iteration_count = int(state.get("iteration_count") or 0)
    max_iterations = max(2, int(state.get("max_iterations") or settings.agent_max_iterations))
    requires_followup = bool(state.get("requires_followup"))
    summary_result = state.get("summary_result") or {}

    if not selected_skills:
        seeded = run_supervisor(state)
        selected_skills = [action for action in INITIAL_ACTION_ORDER if action in list(seeded.get("selected_skills") or [])]
        updates.update(seeded)
        updates["selected_skills"] = selected_skills
        updates["reasoning_goal"] = "对用户提交的多模态材料先做视觉规划，再逐步执行工具、必要时复核，最后输出诈骗风险判断。"
        planner_notes.extend(list(seeded.get("routing_notes") or []))
        if not pending_actions:
            pending_actions = list(selected_skills)

    should_queue_text_rag, text_rag_note = _should_queue_text_rag(
        state,
        selected_skills=selected_skills,
        pending_actions=pending_actions,
        completed_actions=completed_actions,
    )
    if should_queue_text_rag:
        if "text_rag_skill" not in selected_skills:
            selected_skills.append("text_rag_skill")
            updates["selected_skills"] = selected_skills
        pending_actions.append("text_rag_skill")
        if text_rag_note:
            planner_notes.append(text_rag_note)

    if requires_followup and followup_actions:
        for action in followup_actions:
            if action not in pending_actions and action not in completed_actions:
                pending_actions.append(action)
        planner_notes.append(f"Final judge requested follow-up: {', '.join(_unique(followup_actions))}.")
        requires_followup = False
        followup_actions = []
        updates["requires_followup"] = False
        updates["followup_actions"] = []

    next_action = "end"
    stop_reason = state.get("stop_reason")

    if pending_actions:
        if iteration_count >= max_iterations:
            next_action = "final_judge"
            stop_reason = "max_iterations_reached"
            planner_notes.append(f"Iteration cap reached ({iteration_count}/{max_iterations}); forcing final judge.")
        else:
            next_action = pending_actions.pop(0)
            iteration_count += 1
    else:
        last_action = str(state.get("last_action") or "").strip()
        needs_final_pass = (
            not isinstance(summary_result, dict)
            or not summary_result
            or bool(state.get("requires_followup"))
            or last_action != "final_judge"
        )
        if needs_final_pass:
            if iteration_count >= max_iterations and summary_result:
                next_action = "end"
                stop_reason = "max_iterations_reached"
            else:
                next_action = "final_judge"
                iteration_count += 1
        else:
            next_action = "end"
            if not stop_reason:
                stop_reason = "final_decision_ready"

    if next_action == "end" and not stop_reason:
        stop_reason = "no_more_actions"

    updates["planner_notes"] = _unique(planner_notes)
    updates["pending_actions"] = pending_actions
    updates["iteration_count"] = iteration_count
    updates["max_iterations"] = max_iterations
    updates["next_action"] = next_action
    updates["stop_reason"] = stop_reason
    updates["execution_plan"] = _build_execution_plan(
        selected_skills=selected_skills,
        pending_actions=pending_actions,
        completed_actions=completed_actions,
        followup_actions=followup_actions,
    )
    updates["execution_trace"] = execution_trace
    return updates
