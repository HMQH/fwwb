from __future__ import annotations

from collections import Counter

from app.domain.agent.state import AgentState
from app.domain.agent.tools.image_similarity import validate_reverse_image_matches
from app.domain.agent.tools.reverse_image_search_tool import reverse_image_search
from app.domain.agent.types import EvidenceItem, SkillResult
from app.shared.observability.langsmith import traceable


HIGH_RISK_DOMAINS = (
    "xiaohongshu.com",
    "weibo.com",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "pinterest.com",
    "pixiv.net",
    "zhihu.com",
)

IMAGE_FARM_DOMAINS = (
    "baidu.com",
    "bilibili.com",
    "qq.com",
    "toutiao.com",
)


def _score_domains(domains: list[str]) -> tuple[float, list[str]]:
    score = 0.0
    labels: list[str] = []
    if not domains:
        return score, labels

    unique_domains = set(domains)
    if len(unique_domains) >= 3:
        score += 0.3
        labels.append("impersonation_multi_site_match")
    elif len(unique_domains) >= 1:
        score += 0.15
        labels.append("impersonation_public_match")

    if any(any(marker in domain for marker in HIGH_RISK_DOMAINS) for domain in unique_domains):
        score += 0.2
        labels.append("impersonation_social_media_source")

    if any(any(marker in domain for marker in IMAGE_FARM_DOMAINS) for domain in unique_domains):
        score += 0.1
        labels.append("impersonation_public_content_site")

    return min(score, 0.9), labels


def _score_similarity(validated: dict[str, object]) -> tuple[float, list[str]]:
    summary = validated.get("summary") if isinstance(validated, dict) else None
    if not isinstance(summary, dict):
        return 0.0, []

    score = 0.0
    labels: list[str] = []
    hash_near_duplicate_count = int(summary.get("hash_near_duplicate_count") or 0)
    clip_high_similarity_count = int(summary.get("clip_high_similarity_count") or 0)
    max_clip_similarity = summary.get("max_clip_similarity")

    if hash_near_duplicate_count > 0:
        score += 0.42
        labels.append("impersonation_hash_near_duplicate")
    if clip_high_similarity_count > 0:
        score += 0.34
        labels.append("impersonation_clip_high_similarity")
    elif isinstance(max_clip_similarity, (int, float)) and float(max_clip_similarity) >= 0.86:
        score += 0.18
        labels.append("impersonation_clip_medium_similarity")

    return min(score, 0.85), labels


def _build_similarity_summary(validated: dict[str, object]) -> str:
    summary = validated.get("summary") if isinstance(validated, dict) else None
    if not isinstance(summary, dict):
        return "Image similarity validation did not return structured metrics."

    parts: list[str] = []
    if int(summary.get("hash_near_duplicate_count") or 0) > 0:
        parts.append(f"同图/近同图命中 {int(summary.get('hash_near_duplicate_count') or 0)} 个")
    if int(summary.get("clip_high_similarity_count") or 0) > 0:
        parts.append(f"CLIP 高相似命中 {int(summary.get('clip_high_similarity_count') or 0)} 个")
    if summary.get("max_clip_similarity") is not None:
        parts.append(f"最高 CLIP 相似度 {float(summary.get('max_clip_similarity')):.3f}")
    if int(summary.get("cross_site_high_similarity_count") or 0) > 0:
        parts.append(f"跨站点高相似域名 {int(summary.get('cross_site_high_similarity_count') or 0)} 个")
    return "；".join(parts) if parts else "No strong image similarity signal was confirmed."


@traceable(name="agent.skill.impersonation_checker", run_type="chain")
def run_impersonation_checker(state: AgentState) -> dict[str, object]:
    payload = reverse_image_search(state.get("image_paths", []))
    matches = payload.get("matches", [])

    result = SkillResult(
        name="impersonation_checker",
        summary="No public reverse-image match was found by the configured provider.",
        raw=payload,
    )

    if not matches:
        warnings = payload.get("warnings", [])
        if warnings:
            result.summary = "Reverse-image lookup returned no matches or only partial data."
        return {"impersonation_result": result.to_dict()}

    validated = validate_reverse_image_matches(
        image_paths=state.get("image_paths", []),
        matches=matches,
    )
    validated_matches = list(validated.get("validated_matches") or [])
    validated_domains = [str(item.get("domain")) for item in validated_matches if item.get("domain")]

    domain_score, domain_labels = _score_domains(validated_domains)
    similarity_score, similarity_labels = _score_similarity(validated)
    cross_site_high_similarity_count = int(
        ((validated.get("summary") or {}) if isinstance(validated, dict) else {}).get("cross_site_high_similarity_count") or 0
    )

    score = 0.0
    labels: list[str] = []
    if validated_matches:
        score = max(score, domain_score + similarity_score)
        labels.extend(domain_labels)
        labels.extend(similarity_labels)
        if cross_site_high_similarity_count >= 2 and (
            "impersonation_hash_near_duplicate" in labels
            or "impersonation_clip_high_similarity" in labels
        ):
            score = max(score, 0.78)
            labels.append("impersonation_cross_site_confirmed")
        elif cross_site_high_similarity_count >= 1 and (
            "impersonation_hash_near_duplicate" in labels
            or "impersonation_clip_high_similarity" in labels
        ):
            score = max(score, 0.56)
    else:
        score = min(domain_score, 0.18)
        labels.extend(domain_labels)
        labels.append("impersonation_unverified_reverse_match")

    score = round(min(score, 0.95), 3)
    result.triggered = True
    result.risk_score = score
    result.labels = sorted(set(labels))

    domain_counter = Counter(validated_domains)
    top_domains = ", ".join(f"{domain} x{count}" for domain, count in domain_counter.most_common(3))
    if validated_matches:
        result.summary = (
            "High-similarity public reverse-image matches were confirmed, which increases the chance that the image was reused online."
        )
        if top_domains:
            result.summary += f" Top validated sources: {top_domains}."
        result.summary += f" {_build_similarity_summary(validated)}."
    else:
        result.summary = (
            "Reverse-image search returned public matches, but the local similarity layer did not confirm a strong image match."
        )

    result.recommendations.append(
        "Treat profile photos or identity images with public web matches as potentially reused or stolen."
    )
    result.recommendations.append(
        "Ask the other party for a fresh, context-specific photo instead of trusting a reused image."
    )
    if not validated_matches:
        result.recommendations.append(
            "Only treat this as a strong impersonation signal when image similarity and cross-site reuse are both high."
        )

    if validated_matches:
        candidate_items = validated_matches[:6]
    else:
        candidate_items = matches[:3]

    for item in candidate_items:
        detail_parts = []
        if item.get("title"):
            detail_parts.append(str(item["title"]))
        if item.get("source_url"):
            detail_parts.append(str(item["source_url"]))
        similarity_parts = []
        if item.get("phash_distance") is not None:
            similarity_parts.append(f"pHash 距离 {int(item.get('phash_distance') or 0)}")
        if item.get("dhash_distance") is not None:
            similarity_parts.append(f"dHash 距离 {int(item.get('dhash_distance') or 0)}")
        if item.get("clip_similarity") is not None:
            similarity_parts.append(f"CLIP {float(item.get('clip_similarity')):.3f}")
        if similarity_parts:
            detail_parts.append(" / ".join(similarity_parts))
        result.evidence.append(
            EvidenceItem(
                skill="impersonation_checker",
                title="Validated reverse-image match" if item in validated_matches else "Reverse-image match found",
                detail=" | ".join(detail_parts) or "A public web match was detected.",
                severity="warning" if item in validated_matches else "info",
                source_path=str(item.get("source_path") or ""),
                extra={
                    "domain": item.get("domain"),
                    "provider": item.get("provider"),
                    "thumbnail_url": item.get("thumbnail_url"),
                    "image_url": item.get("image_url"),
                    "source_url": item.get("source_url"),
                    "phash_distance": item.get("phash_distance"),
                    "dhash_distance": item.get("dhash_distance"),
                    "hash_similarity": item.get("hash_similarity"),
                    "clip_similarity": item.get("clip_similarity"),
                    "hash_near_duplicate": item.get("hash_near_duplicate"),
                    "clip_high_similarity": item.get("clip_high_similarity"),
                },
            )
        )

    result.raw["similarity_validation"] = validated
    return {"impersonation_result": result.to_dict()}
