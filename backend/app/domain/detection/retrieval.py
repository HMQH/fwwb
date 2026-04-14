"""检测侧 RAG 召回编排。"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from app.domain.detection.rules import RuleAnalysis
from app.domain.rag import search as rag_search
from app.domain.rag.repository import TextChunkSearchHit
from app.shared.core.config import settings


@dataclass(slots=True)
class RetrievalBundle:
    query_text: str
    keywords: list[str]
    black_hits: list[TextChunkSearchHit]
    white_hits: list[TextChunkSearchHit]

    def to_json(self) -> dict:
        return {
            "query_text": self.query_text,
            "keywords": self.keywords,
            "black_hits": [asdict(item) for item in self.black_hits],
            "white_hits": [asdict(item) for item in self.white_hits],
        }


def _limit_text(text: str, *, limit: int = 600) -> str:
    normalized = text.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "…"


def _build_query_text(normalized_text: str, rule_analysis: RuleAnalysis) -> str:
    if not normalized_text:
        return ""
    query_parts = [_limit_text(normalized_text, limit=720)]
    if rule_analysis.hit_rules:
        query_parts.append("风险标签：" + "、".join(rule_analysis.hit_rules[:4]))
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
        "similarity_score": round(hit.score, 4),
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
    return RetrievalBundle(
        query_text=result.query_text,
        keywords=result.keywords,
        black_hits=result.black_hits,
        white_hits=result.white_hits,
    )
