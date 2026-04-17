from __future__ import annotations

from typing import Any


ACTION_LABELS: dict[str, str] = {
    "planner": "规划器",
    "followup_router": "继续复核",
    "qr_inspector": "二维码检测",
    "ocr_phishing": "图文 OCR 检测",
    "official_document_checker": "公文仿冒检测",
    "pii_guard": "敏感信息检测",
    "impersonation_checker": "盗图冒充检测",
    "text_rag_skill": "文本语义检测",
    "image_similarity_verifier": "相似图复核",
    "document_review": "文书复核",
    "conflict_resolver": "分支冲突复核",
    "final_judge": "最终判定",
}


def action_label(action_name: str) -> str:
    return ACTION_LABELS.get(action_name, action_name)


def build_trace_step_id(sequence: int, action_name: str) -> str:
    safe_sequence = max(1, int(sequence))
    return f"step_{safe_sequence}:{action_name}"


def build_execution_trace_item(
    *,
    sequence: int,
    action_name: str,
    iteration: int | None = None,
    status: str = "completed",
) -> dict[str, Any]:
    safe_sequence = max(1, int(sequence))
    return {
        "id": build_trace_step_id(safe_sequence, action_name),
        "action": action_name,
        "key": action_name,
        "label": action_label(action_name),
        "status": status,
        "iteration": int(iteration or safe_sequence),
    }


def build_planner_trace_item() -> dict[str, Any]:
    return {
        "id": "planner:bootstrap",
        "action": "planner",
        "key": "planner",
        "label": action_label("planner"),
        "status": "completed",
        "iteration": 0,
    }
