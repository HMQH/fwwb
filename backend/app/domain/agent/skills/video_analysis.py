from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.types import EvidenceItem, SkillResult
from app.domain.video_ai_detector import service as video_ai_service
from app.domain.video_deception_detector import service as video_deception_service
from app.shared.observability.langsmith import traceable


def _strip(value: Any) -> str:
    return str(value or "").strip()


def _video_pairs_from_state(state: AgentState) -> list[tuple[str, Path]]:
    resolved_paths: list[Path] = []
    for raw_path in list(state.get("video_paths") or []):
        value = _strip(raw_path)
        if value:
            resolved_paths.append(Path(value).expanduser().resolve())

    source_paths = [str(item).strip() for item in list(state.get("video_source_paths") or []) if str(item).strip()]
    pairs: list[tuple[str, Path]] = []
    for index, path in enumerate(resolved_paths):
        source_path = source_paths[index] if index < len(source_paths) else str(path)
        pairs.append((source_path, path))
    return pairs


def _risk_rank(level: str | None) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(_strip(level).lower(), 0)


def _soft_video_behavior_risk(level: str | None) -> str:
    normalized = _strip(level).lower()
    if normalized == "high":
        return "medium"
    if normalized == "medium":
        return "medium"
    return "low"


def _video_ai_trace_meta(summary: dict[str, Any], lead_item: dict[str, Any] | None, *, failed_count: int = 0) -> dict[str, object]:
    analyzed_count = int(summary.get("analyzed_count") or 0)
    suspicious_count = int(summary.get("suspicious_count") or 0)
    overall_risk = _strip(summary.get("overall_risk_level")) or "low"
    lead_std = float((lead_item or {}).get("second_order_std") or 0.0) if lead_item else 0.0
    lead_name = _strip((lead_item or {}).get("file_name")) or "未命名视频"
    detail_parts = [
        f"已分析 {analyzed_count} 段视频",
        f"异常 {suspicious_count} 段" if analyzed_count > 0 else None,
        f"最高 STD {lead_std:.3f}" if lead_item else None,
    ]
    return {
        "_trace_summary": _strip(summary.get("overall_summary")) or "已完成 D3 时序检测。",
        "_trace_detail_line": "；".join(part for part in detail_parts if part) + (f"；重点片段：{lead_name}" if lead_item else ""),
        "_trace_tags": ["D3时序", overall_risk, "关键帧"],
        "_trace_metrics": [
            {"label": "已分析", "value": analyzed_count},
            {"label": "异常", "value": suspicious_count},
            {"label": "失败", "value": failed_count},
            *([{"label": "STD", "value": f"{lead_std:.3f}"}] if lead_item else []),
        ],
    }


def _video_physiology_trace_meta(summary: dict[str, Any], lead_item: dict[str, Any] | None, *, failed_count: int = 0) -> dict[str, object]:
    analyzed_count = int(summary.get("analyzed_count") or 0)
    person_detected_count = int(summary.get("person_detected_count") or 0)
    skipped_no_face_count = int(summary.get("skipped_no_face_count") or 0)
    overall_risk = _strip(summary.get("overall_risk_level")) or "low"
    lead_score = float((lead_item or {}).get("overall_score") or 0.0) if lead_item else 0.0
    detail_parts = [
        f"稳定人物 {person_detected_count} 段" if person_detected_count > 0 else "未检出稳定人物",
        f"完成精检 {analyzed_count} 段" if analyzed_count > 0 else None,
        f"跳过 {skipped_no_face_count} 段" if skipped_no_face_count > 0 else None,
        f"综合分 {lead_score:.2f}" if lead_item else None,
    ]
    return {
        "_trace_summary": _strip(summary.get("overall_summary")) or "已完成人物生理特征判断。",
        "_trace_detail_line": "；".join(part for part in detail_parts if part),
        "_trace_tags": ["人物状态", "轻量验脸", "rPPG", overall_risk],
        "_trace_metrics": [
            {"label": "人物", "value": person_detected_count},
            {"label": "精检", "value": analyzed_count},
            {"label": "跳过", "value": skipped_no_face_count},
            {"label": "失败", "value": failed_count},
            *([{"label": "综合分", "value": f"{lead_score:.2f}"}] if lead_item else []),
        ],
    }


def _empty_behavior_result(total_count: int) -> dict[str, Any]:
    return {
        "items": [],
        "failed_items": [],
        "summary": {
            "model_name": video_deception_service.MODEL_LABEL,
            "total_count": total_count,
            "analyzed_count": 0,
            "failed_count": 0,
            "person_detected_count": 0,
            "skipped_no_face_count": total_count,
            "precheck_person_detected_count": 0,
            "overall_risk_level": "low",
            "overall_summary": "未检测到稳定人脸，已跳过行为与 rPPG 分析，仅保留视频时序检测结果。",
            "lead_item": None,
        },
    }


def _filter_behavior_result_for_face_videos(
    video_pairs: list[tuple[str, Path]],
    face_precheck_result: dict[str, Any],
    behavior_result: dict[str, Any],
) -> dict[str, Any]:
    total_count = len(video_pairs)
    raw_precheck_summary = dict(face_precheck_result.get("summary") or {})
    raw_summary = dict(behavior_result.get("summary") or {})
    precheck_items = [item for item in list(face_precheck_result.get("items") or []) if isinstance(item, dict)]
    precheck_failures = [item for item in list(face_precheck_result.get("failed_items") or []) if isinstance(item, dict)]
    items = [item for item in list(behavior_result.get("items") or []) if isinstance(item, dict)]
    failed_items = [item for item in list(behavior_result.get("failed_items") or []) if isinstance(item, dict)]

    prechecked_paths = {
        _strip(item.get("file_path"))
        for item in precheck_items
        if bool(item.get("person_detected")) and _strip(item.get("file_path"))
    }
    detected_items = [item for item in items if bool(item.get("person_detected"))]

    filtered_failed_items = [
        item for item in failed_items if _strip(item.get("file_path")) in prechecked_paths
    ]
    filtered_failed_items.extend(
        item
        for item in precheck_failures
        if _strip(item.get("file_path"))
        and _strip(item.get("file_path")) not in {_strip(existing.get("file_path")) for existing in filtered_failed_items}
    )

    lead_item: dict[str, Any] | None = None
    overall_risk = "low"
    for item in detected_items:
        level = _strip(item.get("risk_level")) or "low"
        if _risk_rank(level) > _risk_rank(overall_risk):
            overall_risk = level
            lead_item = item
    if lead_item is None and detected_items:
        lead_item = detected_items[0]

    skipped_no_face_count = max(total_count - len(prechecked_paths), 0)
    if detected_items:
        overall_summary = (
            _strip(raw_summary.get("overall_summary"))
            or f"检测到稳定人脸，已完成人脸行为与 rPPG 辅助分析，共识别 {len(detected_items)} 段有人脸视频。"
        )
    elif prechecked_paths and filtered_failed_items:
        overall_summary = "轻量验脸发现了人脸候选，但行为/rPPG 精检未生成稳定结果，当前仅保留视频时序检测。"
    else:
        overall_summary = "未检测到稳定人脸，已跳过行为与 rPPG 分析，仅保留视频时序检测结果。"

    return {
        "items": detected_items,
        "failed_items": filtered_failed_items,
        "summary": {
            "model_name": raw_summary.get("model_name") or raw_precheck_summary.get("model_name"),
            "total_count": total_count,
            "analyzed_count": len(detected_items),
            "failed_count": len(filtered_failed_items),
            "person_detected_count": len(detected_items),
            "skipped_no_face_count": skipped_no_face_count,
            "precheck_person_detected_count": len(prechecked_paths),
            "overall_risk_level": overall_risk,
            "overall_summary": overall_summary,
            "lead_item": lead_item,
        },
    }


@traceable(name="agent.skill.video_ai_detection", run_type="chain")
def run_video_ai_detection(state: AgentState) -> dict[str, object]:
    video_pairs = _video_pairs_from_state(state)
    if not video_pairs:
        result = SkillResult(
            name="video_ai_detection",
            status="skipped",
            summary="当前没有可分析的视频文件，已跳过 AI 视频检测。",
        )
        return {
            "video_ai_result": result.to_dict(),
            "_trace_status": "skipped",
            "_trace_summary": "当前没有可分析的视频文件，已跳过 AI 视频检测。",
            "_trace_detail_line": "未检测到可用视频输入。",
            "_trace_tags": ["D3时序", "已跳过"],
        }

    try:
        batch_result = video_ai_service.analyze_video_batch(video_pairs)
    except Exception as exc:  # noqa: BLE001
        result = SkillResult(
            name="video_ai_detection",
            status="failed",
            summary=f"AI 视频检测失败：{exc}",
            raw={"error": str(exc)},
        )
        return {
            "video_ai_result": result.to_dict(),
            "_trace_status": "failed",
            "_trace_summary": "AI 视频检测失败。",
            "_trace_detail_line": str(exc),
            "_trace_tags": ["D3时序", "失败"],
        }

    summary = dict(batch_result.get("summary") or {})
    items = [item for item in list(batch_result.get("items") or []) if isinstance(item, dict)]
    failed_items = [item for item in list(batch_result.get("failed_items") or []) if isinstance(item, dict)]
    lead_item = summary.get("lead_item") if isinstance(summary.get("lead_item"), dict) else (items[0] if items else None)
    overall_risk = _strip(summary.get("overall_risk_level")) or "low"
    suspicious_count = int(summary.get("suspicious_count") or 0)

    result = SkillResult(
        name="video_ai_detection",
        status="completed",
        summary=_strip(summary.get("overall_summary")) or "已完成 AI 视频时序检测。",
        triggered=bool(items),
        risk_score=float((lead_item or {}).get("confidence") or 0.0),
        labels=[f"video_ai_{overall_risk}"] if items else [],
        raw={
            "summary": summary,
            "items": items,
            "failed_items": failed_items,
            "batch_result": batch_result,
        },
    )

    if lead_item:
        std_value = float((lead_item or {}).get("second_order_std") or 0.0)
        title = "D3 时序异常" if overall_risk in {"medium", "high"} else "D3 时序平稳"
        detail = f"{_strip(lead_item.get('file_name')) or '未命名视频'}：STD {std_value:.3f}"
        explanation = _strip((lead_item or {}).get("summary")) or _strip((lead_item or {}).get("final_reason"))
        if explanation:
            detail = f"{detail}；{explanation}"
        result.evidence.append(
            EvidenceItem(
                skill="video_ai_detection",
                title=title,
                detail=detail,
                severity="warning" if overall_risk in {"medium", "high"} else "info",
            )
        )
        if overall_risk in {"medium", "high"}:
            result.recommendations.extend(
                [
                    "请优先复核异常时刻对应画面。",
                    "结合素材来源与上下文继续核验。",
                ]
            )
    elif failed_items:
        result.summary = "AI 视频检测未产出可用结果。"

    if suspicious_count > 0 and "请优先复核异常时刻对应画面。" not in result.recommendations:
        result.recommendations.append("请优先复核异常时刻对应画面。")

    trace_meta = _video_ai_trace_meta(summary, lead_item, failed_count=len(failed_items))
    return {
        "video_ai_result": result.to_dict(),
        **trace_meta,
    }


@traceable(name="agent.skill.video_physiology_judgement", run_type="chain")
def run_video_physiology_judgement(state: AgentState) -> dict[str, object]:
    video_pairs = _video_pairs_from_state(state)
    if not video_pairs:
        result = SkillResult(
            name="video_physiology_judgement",
            status="skipped",
            summary="当前没有可分析的视频文件，已跳过人物生理特征判断。",
        )
        return {
            "video_deception_result": result.to_dict(),
            "_trace_status": "skipped",
            "_trace_summary": "当前没有可分析的视频文件，已跳过人物生理特征判断。",
            "_trace_detail_line": "未检测到可用视频输入。",
            "_trace_tags": ["人物状态", "已跳过"],
        }

    try:
        face_precheck_result = video_deception_service.precheck_video_batch(video_pairs)
        prechecked_paths = {
            _strip(item.get("file_path"))
            for item in list(face_precheck_result.get("items") or [])
            if isinstance(item, dict) and bool(item.get("person_detected")) and _strip(item.get("file_path"))
        }
        face_video_pairs = [
            (source_path, absolute_path)
            for source_path, absolute_path in video_pairs
            if _strip(source_path) in prechecked_paths
        ]
        if face_video_pairs:
            raw_behavior_result = video_deception_service.analyze_video_batch(face_video_pairs)
        else:
            raw_behavior_result = _empty_behavior_result(len(video_pairs))
        behavior_result = _filter_behavior_result_for_face_videos(
            video_pairs,
            face_precheck_result,
            raw_behavior_result,
        )
    except Exception as exc:  # noqa: BLE001
        result = SkillResult(
            name="video_physiology_judgement",
            status="failed",
            summary=f"人物生理特征判断失败：{exc}",
            raw={"error": str(exc)},
        )
        return {
            "video_deception_result": result.to_dict(),
            "_trace_status": "failed",
            "_trace_summary": "人物生理特征判断失败。",
            "_trace_detail_line": str(exc),
            "_trace_tags": ["人物状态", "失败"],
        }

    summary = dict(behavior_result.get("summary") or {})
    items = [item for item in list(behavior_result.get("items") or []) if isinstance(item, dict)]
    failed_items = [item for item in list(behavior_result.get("failed_items") or []) if isinstance(item, dict)]
    lead_item = summary.get("lead_item") if isinstance(summary.get("lead_item"), dict) else (items[0] if items else None)
    overall_risk = _strip(summary.get("overall_risk_level")) or "low"
    softened_risk = _soft_video_behavior_risk(overall_risk)
    analyzed_count = int(summary.get("analyzed_count") or 0)

    trace_status = "completed" if analyzed_count > 0 else "skipped"
    result = SkillResult(
        name="video_physiology_judgement",
        status="completed" if analyzed_count > 0 else "skipped",
        summary=_strip(summary.get("overall_summary")) or "已完成人物生理特征判断。",
        triggered=bool(analyzed_count),
        risk_score=float((lead_item or {}).get("confidence") or 0.0),
        labels=[f"video_physiology_{softened_risk}"] if analyzed_count > 0 else [],
        raw={
            "summary": summary,
            "items": items,
            "failed_items": failed_items,
            "precheck_result": face_precheck_result,
            "behavior_result": behavior_result,
        },
    )

    if analyzed_count > 0 and lead_item:
        behavior_score = float(lead_item.get("face_behavior_score") or 0.0)
        physiology_score = float(lead_item.get("physiology_score") or 0.0)
        detail = (
            f"{_strip(lead_item.get('file_name')) or '未命名视频'}："
            f"行为分 {behavior_score:.2f} / 生理分 {physiology_score:.2f}"
        )
        explanation = _strip(lead_item.get("summary")) or _strip(lead_item.get("final_reason"))
        if explanation:
            detail = f"{detail}；{explanation}"
        result.evidence.append(
            EvidenceItem(
                skill="video_physiology_judgement",
                title="人物行为 / 生理线索",
                detail=detail,
                severity="warning" if softened_risk in {"medium", "high"} else "info",
            )
        )
        if softened_risk in {"medium", "high"}:
            result.recommendations.extend(
                [
                    "结合异常表情、头动和生理波动继续人工复核。",
                    "优先回看异常时刻附近的前后 10 秒原始片段。",
                ]
            )
    else:
        result.summary = _strip(summary.get("overall_summary")) or "未检测到稳定人脸，已跳过人物生理特征判断。"

    return {
        "video_deception_result": result.to_dict(),
        "_trace_status": trace_status,
        **_video_physiology_trace_meta(summary, lead_item, failed_count=len(failed_items)),
    }
