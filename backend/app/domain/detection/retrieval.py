"""检测侧 RAG 召回编排。"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from app.domain.detection.rules import RuleAnalysis
from app.domain.rag import search as rag_search
from app.domain.rag.repository import TextChunkSearchHit
from app.shared.core.config import settings


@dataclass(slots=True)
class RetrievalFeatures:
    black_top1: float
    black_avg_top3: float
    black_avg_top5: float
    white_top1: float
    white_avg_top3: float
    white_avg_top5: float
    black_support_count: int
    white_support_count: int
    similarity_gap_top1: float
    similarity_gap_avg3: float
    hybrid_black_ratio: float
    retrieval_score: int
    evidence_alignment: str

    def to_json(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class RetrievalBundle:
    query_text: str
    keywords: list[str]
    black_hits: list[TextChunkSearchHit]
    white_hits: list[TextChunkSearchHit]
    features: RetrievalFeatures

    def to_json(self) -> dict:
        return {
            "query_text": self.query_text,
            "keywords": self.keywords,
            "black_hits": [asdict(item) for item in self.black_hits],
            "white_hits": [asdict(item) for item in self.white_hits],
            "features": self.features.to_json(),
        }


def _limit_text(text: str, *, limit: int = 600) -> str:
    normalized = text.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "…"


def _normalize_score(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _avg_score(hits: list[TextChunkSearchHit], *, top_k: int) -> float:
    if not hits:
        return 0.0
    items = [_normalize_score(hit.score) for hit in hits[:top_k]]
    if not items:
        return 0.0
    return round(sum(items) / len(items), 4)


def _support_count(hits: list[TextChunkSearchHit], *, threshold: float = 0.46) -> int:
    return sum(1 for hit in hits if _normalize_score(hit.score) >= threshold)


def _hybrid_ratio(hits: list[TextChunkSearchHit]) -> float:
    if not hits:
        return 0.0
    hybrid_count = sum(1 for hit in hits if hit.match_source == "hybrid")
    return round(hybrid_count / len(hits), 4)


def _score_retrieval(black_hits: list[TextChunkSearchHit], white_hits: list[TextChunkSearchHit]) -> RetrievalFeatures:
    black_top1 = _normalize_score(black_hits[0].score) if black_hits else 0.0
    black_avg_top3 = _avg_score(black_hits, top_k=3)
    black_avg_top5 = _avg_score(black_hits, top_k=5)
    white_top1 = _normalize_score(white_hits[0].score) if white_hits else 0.0
    white_avg_top3 = _avg_score(white_hits, top_k=3)
    white_avg_top5 = _avg_score(white_hits, top_k=5)
    similarity_gap_top1 = round(black_top1 - white_top1, 4)
    similarity_gap_avg3 = round(black_avg_top3 - white_avg_top3, 4)
    hybrid_black_ratio = _hybrid_ratio(black_hits)
    black_support_count = _support_count(black_hits)
    white_support_count = _support_count(white_hits)

    raw_score = (
        black_top1 * 0.38
        + black_avg_top3 * 0.24
        + black_avg_top5 * 0.06
        + max(similarity_gap_top1, 0.0) * 0.16
        + max(similarity_gap_avg3, 0.0) * 0.12
        + hybrid_black_ratio * 0.06
        + min(black_support_count, 3) * 0.03
        - white_avg_top3 * 0.18
        - white_top1 * 0.08
        - min(white_support_count, 3) * 0.02
    )
    retrieval_score = max(0, min(100, round(raw_score * 100)))

    if black_avg_top3 >= white_avg_top3 + 0.12 or black_top1 >= white_top1 + 0.16:
        evidence_alignment = "black"
    elif white_avg_top3 >= black_avg_top3 + 0.08:
        evidence_alignment = "white"
    else:
        evidence_alignment = "mixed"

    return RetrievalFeatures(
        black_top1=round(black_top1, 4),
        black_avg_top3=black_avg_top3,
        black_avg_top5=black_avg_top5,
        white_top1=round(white_top1, 4),
        white_avg_top3=white_avg_top3,
        white_avg_top5=white_avg_top5,
        black_support_count=black_support_count,
        white_support_count=white_support_count,
        similarity_gap_top1=similarity_gap_top1,
        similarity_gap_avg3=similarity_gap_avg3,
        hybrid_black_ratio=hybrid_black_ratio,
        retrieval_score=retrieval_score,
        evidence_alignment=evidence_alignment,
    )


def _build_query_text(normalized_text: str, rule_analysis: RuleAnalysis) -> str:
    if not normalized_text:
        return ""
    query_parts = [_limit_text(normalized_text, limit=720)]
    dominant_signals = [
        label
        for label, value in {
            "索要验证码": rule_analysis.soft_signals.get("credential_request", 0.0),
            "要求转账": rule_analysis.soft_signals.get("transfer_request", 0.0),
            "身份冒充": rule_analysis.soft_signals.get("impersonation", 0.0),
            "引导下载": rule_analysis.soft_signals.get("download_redirect", 0.0),
            "远程控制": rule_analysis.soft_signals.get("remote_control", 0.0),
            "反诈提醒": rule_analysis.soft_signals.get("anti_fraud_context", 0.0),
        }.items()
        if value >= 0.52
    ]
    if dominant_signals:
        query_parts.append("软特征：" + "、".join(dominant_signals[:5]))
    if rule_analysis.fraud_type_hints:
        query_parts.append("类型线索：" + "、".join(rule_analysis.fraud_type_hints[:3]))
    return "\n".join(query_parts)


def _annotate_reason(hit: TextChunkSearchHit) -> str:
    label_prefix = "历史诈骗样本" if hit.sample_label == "black" else "历史正常样本"
    type_suffix = f"，类型偏向“{hit.fraud_type}”" if hit.fraud_type else ""
    source_suffix = f"，来源 {hit.data_source}" if hit.data_source else ""
    mode_suffix = {
        "vector": "语义相似",
        "keyword": "关键词命中",
        "hybrid": "语义与关键词同时命中",
    }.get(hit.match_source, "相似检索")
    return f"{label_prefix}{type_suffix}{source_suffix}，本条通过{mode_suffix}召回。"


def format_evidence(hit: TextChunkSearchHit) -> dict:
    return {
        "source_id": hit.source_id,
        "chunk_index": hit.chunk_index,
        "sample_label": hit.sample_label,
        "fraud_type": hit.fraud_type,
        "data_source": hit.data_source,
        "url": hit.url,
        "chunk_text": hit.chunk_text,
        "similarity_score": round(_normalize_score(hit.score), 4),
        "match_source": hit.match_source,
        "reason": _annotate_reason(hit),
    }


def retrieve_text_evidence(
    db: Session,
    *,
    text: str,
    rule_analysis: RuleAnalysis,
) -> RetrievalBundle:
    query_text = _build_query_text(text, rule_analysis)
    result = rag_search.search_comparative_text(
        db,
        query_text=query_text,
        keywords=rule_analysis.search_keywords,
        black_top_k=settings.detection_retrieval_black_top_k,
        white_top_k=settings.detection_retrieval_white_top_k,
        vector_top_k=settings.detection_retrieval_vector_top_k,
        keyword_top_k=settings.detection_retrieval_keyword_top_k,
    )
    features = _score_retrieval(result.black_hits, result.white_hits)
    return RetrievalBundle(
        query_text=result.query_text,
        keywords=result.keywords,
        black_hits=result.black_hits,
        white_hits=result.white_hits,
        features=features,
    )
