from __future__ import annotations

from typing import Any

from app.domain.agent.state import AgentState
from app.domain.agent.tools.image_similarity import validate_reverse_image_matches
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


def _get_similarity_payload(state: AgentState) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    impersonation_result = state.get("impersonation_result") or {}
    if not isinstance(impersonation_result, dict):
        return None, None
    raw = impersonation_result.get("raw")
    if not isinstance(raw, dict):
        return None, None
    validation = raw.get("similarity_validation")
    if isinstance(validation, dict):
        return raw, validation
    matches = list(raw.get("matches") or [])
    if not matches:
        return raw, None
    validation = validate_reverse_image_matches(
        image_paths=list(state.get("image_paths") or []),
        matches=matches,
    )
    return raw, validation


@traceable(name="agent.skill.image_similarity_verifier", run_type="chain")
def run_image_similarity_verifier(state: AgentState) -> dict[str, object]:
    raw, validation = _get_similarity_payload(state)
    result = SkillResult(
        name="image_similarity_verifier",
        status="completed",
        summary="No reverse-image similarity evidence was available for second-pass verification.",
        raw={"source": "impersonation_checker"},
    )

    if raw is None:
        result.status = "skipped"
        result.summary = "Image similarity verifier was skipped because impersonation analysis has not run yet."
        return {"image_similarity_result": result.to_dict()}

    if not isinstance(validation, dict):
        result.status = "skipped"
        result.summary = "Reverse-image matches exist, but no local similarity metrics could be produced."
        result.raw["reverse_image_matches"] = list(raw.get("matches") or [])[:5]
        return {"image_similarity_result": result.to_dict()}

    summary = dict(validation.get("summary") or {})
    validated_matches = list(validation.get("validated_matches") or [])
    result.raw["similarity_validation"] = validation
    result.triggered = bool(validated_matches or raw.get("matches"))

    hash_near_duplicate_count = int(summary.get("hash_near_duplicate_count") or 0)
    clip_high_similarity_count = int(summary.get("clip_high_similarity_count") or 0)
    cross_site_high_similarity_count = int(summary.get("cross_site_high_similarity_count") or 0)
    validated_match_count = int(summary.get("validated_match_count") or 0)
    max_clip_similarity = summary.get("max_clip_similarity")
    max_hash_similarity = float(summary.get("max_hash_similarity") or 0.0)
    strongest_match = summary.get("strongest_match") if isinstance(summary.get("strongest_match"), dict) else {}

    score = 0.0
    labels: list[str] = []
    if hash_near_duplicate_count > 0:
        score = max(score, 0.76)
        labels.append("image_similarity_hash_near_duplicate")
    if clip_high_similarity_count > 0:
        score = max(score, 0.72)
        labels.append("image_similarity_clip_high")
    elif isinstance(max_clip_similarity, (int, float)) and float(max_clip_similarity) >= 0.86:
        score = max(score, 0.52)
        labels.append("image_similarity_clip_medium")
    if cross_site_high_similarity_count >= 2:
        score = max(score, 0.84)
        labels.append("image_similarity_cross_site_reuse")
    elif validated_match_count > 0:
        score = max(score, 0.42)
        labels.append("image_similarity_partial_match")
    if not validated_matches and raw.get("matches"):
        labels.append("image_similarity_unconfirmed")
        score = max(score, 0.18)

    result.risk_score = round(min(score, 0.95), 3)
    result.labels = labels

    if cross_site_high_similarity_count >= 1 and (hash_near_duplicate_count > 0 or clip_high_similarity_count > 0):
        result.summary = "Second-pass similarity verification confirmed that the uploaded image is highly similar to public web images."
        result.recommendations.append("把这张图视为高风险复用素材，不要单独把它当成真人/官方凭证。")
    elif validated_matches:
        result.summary = "Second-pass similarity verification found reusable public matches, but the evidence is weaker than a near-duplicate hit."
        result.recommendations.append("需要结合聊天内容、账号资料和时间上下文一起判断图片是否被冒用。")
    else:
        result.summary = "Reverse-image search returned candidates, but the second-pass similarity layer did not confirm a strong match."
        result.recommendations.append("目前不能仅凭百度搜图结果认定为盗图，建议再结合账号行为与其他证据。")

    result.recommendations.append("优先查看最高相似来源是否来自社交平台、公开图库或历史新闻页面。")

    for item in validated_matches[:5]:
        detail_parts = []
        if item.get("title"):
            detail_parts.append(str(item.get("title")))
        if item.get("source_url"):
            detail_parts.append(str(item.get("source_url")))
        metric_parts = []
        if item.get("phash_distance") is not None:
            metric_parts.append(f"pHash={int(item.get('phash_distance') or 0)}")
        if item.get("dhash_distance") is not None:
            metric_parts.append(f"dHash={int(item.get('dhash_distance') or 0)}")
        if item.get("clip_similarity") is not None:
            metric_parts.append(f"CLIP={float(item.get('clip_similarity')):.3f}")
        if metric_parts:
            detail_parts.append(" / ".join(metric_parts))
        result.evidence.append(
            EvidenceItem(
                skill="image_similarity_verifier",
                title="Verified similar image",
                detail=" | ".join(detail_parts) or "A validated similar image was found.",
                severity="warning",
                source_path=str(item.get("source_path") or "") or None,
                extra={
                    "domain": item.get("domain"),
                    "hash_similarity": item.get("hash_similarity"),
                    "clip_similarity": item.get("clip_similarity"),
                },
            )
        )

    if not validated_matches and raw.get("matches"):
        strongest_domain = str(strongest_match.get("domain") or "").strip()
        strongest_clip = strongest_match.get("clip_similarity")
        strongest_parts = [f"strongest local hash similarity is {max_hash_similarity:.3f}"]
        if isinstance(strongest_clip, (int, float)):
            strongest_parts.append(f"CLIP similarity is {float(strongest_clip):.3f}")
        if strongest_domain:
            strongest_parts.append(f"top source domain: {strongest_domain}")
        result.evidence.append(
            EvidenceItem(
                skill="image_similarity_verifier",
                title="Unconfirmed reverse-image candidates",
                detail="; ".join(strongest_parts) + ".",
                severity="info",
            )
        )

    return {"image_similarity_result": result.to_dict()}
