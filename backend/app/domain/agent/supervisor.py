from __future__ import annotations

from app.domain.agent.state import AgentState
from app.domain.agent.vision_planner import run_vision_planner
from app.shared.observability.langsmith import traceable


@traceable(name="agent.supervisor", run_type="chain")
def run_supervisor(state: AgentState) -> AgentState:
    selected: list[str] = []
    notes: list[str] = []
    unsupported: list[str] = []
    vision_plan: dict[str, object] | None = None

    has_image = bool(state.get("image_paths"))
    has_text = bool((state.get("text_content") or "").strip())
    has_audio = bool(state.get("audio_paths"))
    has_video = bool(state.get("video_paths"))

    if has_image:
        vision_plan = run_vision_planner(state)
        planned_tools = list(vision_plan.get("priority_order") or vision_plan.get("recommended_tools") or [])
        selected.extend(planned_tools)
        summary = str(vision_plan.get("summary") or "").strip()
        reasoning = str(vision_plan.get("reasoning") or "").strip()
        error = str(vision_plan.get("error") or "").strip()
        if summary:
            notes.append(f"视觉规划：{summary}")
        if reasoning:
            notes.append(f"规划依据：{reasoning}")
        if error:
            notes.append(f"视觉规划降级：{error}")
        observations = list(vision_plan.get("observations") or [])
        if observations:
            notes.append("图像观察：" + "；".join(str(item).strip() for item in observations[:3] if str(item).strip()))

    if has_text and not has_image:
        selected.append("text_rag_skill")
        notes.append("这是文本优先输入，先直接进入文本 RAG 语义判断。")
    elif has_text and has_image:
        notes.append("检测到图片 + 文本输入；文本 RAG 将在 OCR 完成后按条件触发，以合并图中识别文字与用户原始文本。")
    elif has_image:
        notes.append("检测到图片输入；先根据视觉规划调用图像工具，再根据 OCR 结果决定是否进入文本 RAG。")
    else:
        notes.append("当前没有图片或文本输入，图像/文本分支不会启动实质分析。")

    if has_video:
        selected.extend(["video_ai_detection", "video_physiology_judgement"])
        notes.append("检测到视频输入；视频将进入 agent graph，依次执行 AI 视频检测、人物生理特征判断和最终判定。")

    if has_audio:
        unsupported.append("audio")
        notes.append("已上传音频，但音频 agent 技能暂未接入当前图。")

    payload: AgentState = {
        "selected_skills": selected,
        "routing_notes": notes,
        "unsupported_modalities": unsupported,
    }
    if vision_plan is not None:
        payload["vision_plan"] = vision_plan
    return payload
