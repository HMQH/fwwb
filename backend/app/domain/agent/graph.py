from __future__ import annotations

from functools import lru_cache
from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from app.domain.agent.planner import run_planner
from app.domain.agent.trace import build_execution_trace_item
from app.domain.agent.skills.conflict_resolver import run_conflict_resolver
from app.domain.agent.skills.document_review import run_document_review
from app.domain.agent.skills.final_judge import run_final_judge
from app.domain.agent.skills.image_similarity_verifier import run_image_similarity_verifier
from app.domain.agent.skills.impersonation_checker import run_impersonation_checker
from app.domain.agent.skills.ocr_phishing import run_ocr_phishing
from app.domain.agent.skills.official_document_checker import run_official_document_checker
from app.domain.agent.skills.pii_guard import run_pii_guard
from app.domain.agent.skills.qr_inspector import run_qr_inspector
from app.domain.agent.skills.text_rag_skill import run_text_rag_skill
from app.domain.agent.skills.video_analysis import run_video_ai_detection, run_video_physiology_judgement
from app.domain.agent.state import AgentState


def _normalize_trace_metrics(metrics: Any) -> list[dict[str, Any]]:
    if isinstance(metrics, list):
        normalized: list[dict[str, Any]] = []
        for item in metrics:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            value = item.get("value")
            if not label or not isinstance(value, (str, int, float)):
                continue
            normalized.append({"label": label, "value": value})
        return normalized[:4]
    if isinstance(metrics, dict):
        normalized = []
        for key, value in metrics.items():
            label = str(key or "").strip()
            if not label or not isinstance(value, (str, int, float)):
                continue
            normalized.append({"label": label, "value": value})
        return normalized[:4]
    return []


def _normalize_trace_tags(tags: Any) -> list[str]:
    if not isinstance(tags, list):
        return []
    normalized: list[str] = []
    for item in tags:
        value = str(item or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized[:4]


def _apply_trace_meta(
    item: dict[str, Any],
    *,
    summary: str | None = None,
    detail_line: str | None = None,
    tags: list[str] | None = None,
    metrics: Any = None,
) -> dict[str, Any]:
    if summary:
        item["summary"] = summary
    if detail_line:
        item["detail_line"] = detail_line
    normalized_tags = _normalize_trace_tags(tags)
    if normalized_tags:
        item["tags"] = normalized_tags
    normalized_metrics = _normalize_trace_metrics(metrics)
    if normalized_metrics:
        item["metrics"] = normalized_metrics
    return item


def _running_trace_meta(action_name: str, state: AgentState) -> dict[str, Any]:
    video_count = len(list(state.get("video_paths") or []))
    if action_name == "video_ai_detection":
        return {
            "summary": "正在抽取关键帧并计算 D3 二阶时序波动。",
            "detail_line": "先从视频中抽取分析片段，再编码帧间变化并统计时序异常幅度。",
            "tags": ["D3时序", "关键帧", "二阶特征"],
            "metrics": [{"label": "视频", "value": video_count}] if video_count > 0 else [],
        }
    if action_name == "video_physiology_judgement":
        return {
            "summary": "正在筛选稳定人物并分析行为 / rPPG 生理波动。",
            "detail_line": "先轻量验脸，再对命中人物的视频做行为波动和非接触生理线索分析。",
            "tags": ["人物状态", "轻量验脸", "rPPG"],
            "metrics": [{"label": "视频", "value": video_count}] if video_count > 0 else [],
        }
    if action_name == "final_judge":
        return {
            "summary": "正在汇总视频线索并生成最终判定。",
            "detail_line": "融合 D3 时序结果与人物生理特征结果，输出最终风险结论。",
            "tags": ["结果汇总", "最终判定"],
        }
    return {}


def _emit_progress(
    state: AgentState,
    *,
    phase: str,
    current_action: str,
    trace: list[dict[str, Any]],
    completed_actions: list[str] | None = None,
    action_instance_counter: int | None = None,
) -> None:
    callback = state.get("progress_callback")
    if not callable(callback):
        return
    callback(
        {
            "phase": phase,
            "current_action": current_action,
            "execution_trace": trace,
            "selected_skills": list(state.get("selected_skills") or []),
            "pending_actions": list(state.get("pending_actions") or []),
            "completed_actions": list(completed_actions if completed_actions is not None else (state.get("completed_actions") or [])),
            "followup_actions": list(state.get("followup_actions") or []),
            "execution_plan": list(state.get("execution_plan") or []),
            "iteration_count": int(state.get("iteration_count") or 0),
            "max_iterations": int(state.get("max_iterations") or 0),
            "requires_followup": bool(state.get("requires_followup")),
            "stop_reason": state.get("stop_reason"),
            "action_instance_counter": action_instance_counter if action_instance_counter is not None else int(state.get("action_instance_counter") or 0),
        }
    )


def _mark_completed(state: AgentState, action_name: str, *, status: str = "completed") -> AgentState:
    completed = list(state.get("completed_actions") or [])
    if action_name not in completed:
        completed.append(action_name)
    trace = list(state.get("execution_trace") or [])
    sequence = int(state.get("action_instance_counter") or 0) + 1
    trace_item = build_execution_trace_item(
        sequence=sequence,
        action_name=action_name,
        iteration=int(state.get("iteration_count") or sequence),
        status=status,
    )
    trace.append(trace_item)
    return {
        "completed_actions": completed,
        "execution_trace": trace,
        "action_instance_counter": sequence,
        "last_action": action_name,
    }


def _wrap_action(action_name: str, func: Callable[[AgentState], dict[str, object]]) -> Callable[[AgentState], AgentState]:
    def _runner(state: AgentState) -> AgentState:
        sequence = int(state.get("action_instance_counter") or 0) + 1
        running_trace = list(state.get("execution_trace") or [])
        running_item = build_execution_trace_item(
            sequence=sequence,
            action_name=action_name,
            iteration=int(state.get("iteration_count") or sequence),
            status="running",
        )
        _apply_trace_meta(running_item, **_running_trace_meta(action_name, state))
        running_trace.append(running_item)
        _emit_progress(
            state,
            phase="action_started",
            current_action=action_name,
            trace=running_trace,
        )
        payload = dict(func(state) or {})
        trace_action_name = str(payload.pop("_trace_action_name", action_name) or action_name).strip() or action_name
        trace_status = str(payload.pop("_trace_status", "completed") or "completed").strip() or "completed"
        trace_summary = str(payload.pop("_trace_summary", "") or "").strip() or None
        trace_detail_line = str(payload.pop("_trace_detail_line", "") or "").strip() or None
        trace_tags = payload.pop("_trace_tags", None)
        trace_metrics = payload.pop("_trace_metrics", None)
        completed_state = _mark_completed(state, trace_action_name, status=trace_status)
        completed_trace = list(completed_state.get("execution_trace") or [])
        if completed_trace:
            _apply_trace_meta(
                completed_trace[-1],
                summary=trace_summary,
                detail_line=trace_detail_line,
                tags=trace_tags,
                metrics=trace_metrics,
            )
        completed_state["execution_trace"] = completed_trace
        payload.update(completed_state)
        merged_state = dict(state)
        merged_state.update(payload)
        _emit_progress(
            merged_state,
            phase="action_completed",
            current_action=trace_action_name,
            trace=list(completed_state.get("execution_trace") or []),
            completed_actions=list(completed_state.get("completed_actions") or []),
            action_instance_counter=int(completed_state.get("action_instance_counter") or sequence),
        )
        return payload

    return _runner


def _route_from_planner(state: AgentState) -> str:
    next_action = str(state.get("next_action") or "end").strip()
    return next_action or "end"


@lru_cache(maxsize=1)
def get_detection_graph():
    graph = StateGraph(AgentState)
    graph.add_node("planner", run_planner)
    graph.add_node("qr_inspector", _wrap_action("qr_inspector", run_qr_inspector))
    graph.add_node("ocr_phishing", _wrap_action("ocr_phishing", run_ocr_phishing))
    graph.add_node("official_document_checker", _wrap_action("official_document_checker", run_official_document_checker))
    graph.add_node("pii_guard", _wrap_action("pii_guard", run_pii_guard))
    graph.add_node("impersonation_checker", _wrap_action("impersonation_checker", run_impersonation_checker))
    graph.add_node("video_ai_detection", _wrap_action("video_ai_detection", run_video_ai_detection))
    graph.add_node(
        "video_physiology_judgement",
        _wrap_action("video_physiology_judgement", run_video_physiology_judgement),
    )
    graph.add_node("text_rag_skill", _wrap_action("text_rag_skill", run_text_rag_skill))
    graph.add_node("image_similarity_verifier", _wrap_action("image_similarity_verifier", run_image_similarity_verifier))
    graph.add_node("document_review", _wrap_action("document_review", run_document_review))
    graph.add_node("conflict_resolver", _wrap_action("conflict_resolver", run_conflict_resolver))
    graph.add_node("final_judge", _wrap_action("final_judge", run_final_judge))

    graph.add_edge(START, "planner")
    graph.add_conditional_edges(
        "planner",
        _route_from_planner,
        {
            "qr_inspector": "qr_inspector",
            "ocr_phishing": "ocr_phishing",
            "official_document_checker": "official_document_checker",
            "pii_guard": "pii_guard",
            "impersonation_checker": "impersonation_checker",
            "video_ai_detection": "video_ai_detection",
            "video_physiology_judgement": "video_physiology_judgement",
            "text_rag_skill": "text_rag_skill",
            "image_similarity_verifier": "image_similarity_verifier",
            "document_review": "document_review",
            "conflict_resolver": "conflict_resolver",
            "final_judge": "final_judge",
            "end": END,
        },
    )

    for action in (
        "qr_inspector",
        "ocr_phishing",
        "official_document_checker",
        "pii_guard",
        "impersonation_checker",
        "video_ai_detection",
        "video_physiology_judgement",
        "text_rag_skill",
        "image_similarity_verifier",
        "document_review",
        "conflict_resolver",
        "final_judge",
    ):
        graph.add_edge(action, "planner")

    return graph.compile()
