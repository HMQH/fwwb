from __future__ import annotations

from functools import lru_cache
from typing import Callable

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
from app.domain.agent.state import AgentState


def _mark_completed(state: AgentState, action_name: str) -> AgentState:
    completed = list(state.get("completed_actions") or [])
    if action_name not in completed:
        completed.append(action_name)
    trace = list(state.get("execution_trace") or [])
    sequence = int(state.get("action_instance_counter") or 0) + 1
    trace.append(
        build_execution_trace_item(
            sequence=sequence,
            action_name=action_name,
            iteration=int(state.get("iteration_count") or sequence),
        )
    )
    return {
        "completed_actions": completed,
        "execution_trace": trace,
        "action_instance_counter": sequence,
        "last_action": action_name,
    }


def _wrap_action(action_name: str, func: Callable[[AgentState], dict[str, object]]) -> Callable[[AgentState], AgentState]:
    def _runner(state: AgentState) -> AgentState:
        payload = dict(func(state) or {})
        payload.update(_mark_completed(state, action_name))
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
        "text_rag_skill",
        "image_similarity_verifier",
        "document_review",
        "conflict_resolver",
        "final_judge",
    ):
        graph.add_edge(action, "planner")

    return graph.compile()
