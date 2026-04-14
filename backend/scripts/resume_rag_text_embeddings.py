"""直接续跑 sources_all_data -> rag_text_chunks 的文本 embedding。

默认行为：
1. 找出当前 embedding_model 下「缺失 / 失败 / 状态与实际 chunk 数不一致」的 source。
2. 按批次创建 backfill job。
3. 立即顺序执行这些 job，直到跑完。

使用示例：
    python scripts/resume_rag_text_embeddings.py
    python scripts/resume_rag_text_embeddings.py --source-id-min 200000 --source-id-max 250954
    python scripts/resume_rag_text_embeddings.py --batch-size 100 --limit 1000
    python scripts/resume_rag_text_embeddings.py --dry-run

如果你改过 sources_all_data.content，希望按最新内容重新判断是否需要更新，
可以改用：
    python scripts/resume_rag_text_embeddings.py --full-scan
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

BACKEND_ROOT = Path(__file__).resolve().parents[1]
os.chdir(BACKEND_ROOT)
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.domain.rag import repository as rag_repository
from app.domain.rag import service as rag_service
from app.shared.core.config import settings
from app.shared.db.session import SessionLocal


@dataclass(slots=True)
class ResumeCandidate:
    source_id: int
    sync_status: str
    expected_chunk_count: int
    actual_chunk_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="续跑 sources_all_data 到 rag_text_chunks 未完成/异常的文本 embedding"
    )
    parser.add_argument("--source-id-min", type=int, default=None, help="只处理 >= 该 source_id 的数据")
    parser.add_argument("--source-id-max", type=int, default=None, help="只处理 <= 该 source_id 的数据")
    parser.add_argument(
        "--data-source",
        dest="data_sources",
        action="append",
        default=None,
        help="只处理指定 data_source，可重复传入多次",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="每个 backfill job 包含多少条 source_id，默认 200",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="最多处理多少条候选 source，用于试跑",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只输出待处理统计，不真正执行",
    )
    parser.add_argument(
        "--full-scan",
        action="store_true",
        help="不查缺失列表，直接按现有 backfill 逻辑全量扫描一次（会自动跳过未变化且已完成的 source）",
    )
    return parser.parse_args()


def _normalize_data_sources(values: Sequence[str] | None) -> list[str] | None:
    if not values:
        return None
    normalized = [value.strip() for value in values if value and value.strip()]
    return normalized or None


def _chunked(values: Sequence[int], size: int) -> Iterable[list[int]]:
    batch_size = max(1, size)
    for index in range(0, len(values), batch_size):
        yield list(values[index:index + batch_size])


def _build_candidate_statement(
    *,
    source_id_min: int | None,
    source_id_max: int | None,
    data_sources: list[str] | None,
    limit: int | None,
):
    sql_parts = [
        """
        WITH chunk_counts AS (
          SELECT
            source_id,
            embedding_model,
            COUNT(*)::int AS actual_chunk_count
          FROM public.rag_text_chunks
          WHERE embedding_model = :embedding_model
          GROUP BY source_id, embedding_model
        )
        SELECT
          s.id AS source_id,
          COALESCE(st.status, 'missing') AS sync_status,
          COALESCE(st.chunk_count, 0) AS expected_chunk_count,
          COALESCE(cc.actual_chunk_count, 0) AS actual_chunk_count
        FROM public.sources_all_data s
        LEFT JOIN public.rag_source_sync_state st
          ON st.source_id = s.id
         AND st.modality = 'text'
         AND st.embedding_model = :embedding_model
        LEFT JOIN chunk_counts cc
          ON cc.source_id = s.id
         AND cc.embedding_model = :embedding_model
        WHERE s.content IS NOT NULL
          AND btrim(s.content) <> ''
          AND (s.task_type ? 'text' OR s.task_type ? 'website')
        """
    ]
    params: dict[str, object] = {"embedding_model": settings.rag_embedding_model}
    expanding_binds: list[str] = []

    if source_id_min is not None:
        sql_parts.append("  AND s.id >= :source_id_min")
        params["source_id_min"] = int(source_id_min)
    if source_id_max is not None:
        sql_parts.append("  AND s.id <= :source_id_max")
        params["source_id_max"] = int(source_id_max)
    if data_sources:
        sql_parts.append("  AND s.data_source IN :data_sources")
        params["data_sources"] = data_sources
        expanding_binds.append("data_sources")

    sql_parts.append(
        """
          AND (
            st.id IS NULL
            OR st.status = 'failed'
            OR (st.status = 'completed' AND COALESCE(st.chunk_count, 0) <> COALESCE(cc.actual_chunk_count, 0))
            OR (st.status = 'empty' AND COALESCE(cc.actual_chunk_count, 0) <> 0)
          )
        ORDER BY s.id
        """
    )

    if limit is not None:
        sql_parts.append("LIMIT :limit")
        params["limit"] = int(limit)

    statement = text("\n".join(sql_parts))
    for bind_name in expanding_binds:
        statement = statement.bindparams(bindparam(bind_name, expanding=True))
    return statement, params


def find_resume_candidates(
    db: Session,
    *,
    source_id_min: int | None,
    source_id_max: int | None,
    data_sources: list[str] | None,
    limit: int | None,
) -> list[ResumeCandidate]:
    statement, params = _build_candidate_statement(
        source_id_min=source_id_min,
        source_id_max=source_id_max,
        data_sources=data_sources,
        limit=limit,
    )
    rows = db.execute(statement, params).mappings().all()
    return [
        ResumeCandidate(
            source_id=int(row["source_id"]),
            sync_status=str(row["sync_status"]),
            expected_chunk_count=int(row["expected_chunk_count"]),
            actual_chunk_count=int(row["actual_chunk_count"]),
        )
        for row in rows
    ]


def run_single_batch(batch_source_ids: list[int]) -> tuple[int, int, int]:
    db = SessionLocal()
    try:
        job = rag_service.create_backfill_job(
            db,
            source_ids=batch_source_ids,
            source_id_min=None,
            source_id_max=None,
            data_sources=None,
            force=True,
            limit=None,
        )
        print(
            f"[job] 创建批次任务 {job.id}，sources={len(batch_source_ids)}，"
            f"id范围={batch_source_ids[0]}~{batch_source_ids[-1]}"
        )
        job = rag_service.process_job(db, job.id)
        print(
            f"[job] 完成 {job.id} status={job.status} "
            f"success={job.success_count} fail={job.fail_count} skipped={job.skipped_count}"
        )
        return job.success_count, job.fail_count, job.skipped_count
    finally:
        db.close()


def run_full_scan(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        normalized_data_sources = _normalize_data_sources(args.data_sources)
        if args.dry_run:
            filters = {
                "force": False,
            }
            if args.source_id_min is not None:
                filters["source_id_min"] = int(args.source_id_min)
            if args.source_id_max is not None:
                filters["source_id_max"] = int(args.source_id_max)
            if normalized_data_sources:
                filters["data_sources"] = normalized_data_sources
            total_count = rag_repository.count_sources_for_filters(db, filters)
            if args.limit is not None:
                total_count = min(total_count, int(args.limit))
            print(
                f"[dry-run] full-scan 预计扫描 source 数={total_count}，"
                f"embedding_model={settings.rag_embedding_model}"
            )
            return 0

        job = rag_service.create_backfill_job(
            db,
            source_ids=None,
            source_id_min=args.source_id_min,
            source_id_max=args.source_id_max,
            data_sources=normalized_data_sources,
            force=False,
            limit=args.limit,
        )
        print(
            f"[job] 创建 full-scan 任务 {job.id}，embedding_model={settings.rag_embedding_model}，"
            f"预计扫描 source 数={job.total_count}"
        )

        job = rag_service.process_job(db, job.id)
        print(
            f"[job] 完成 {job.id} status={job.status} "
            f"success={job.success_count} fail={job.fail_count} skipped={job.skipped_count}"
        )
        if job.fail_count > 0:
            print("[warn] 仍有部分 source 处理失败，可再次运行本脚本重试。")
        return 0
    finally:
        db.close()


def main() -> int:
    args = parse_args()
    data_sources = _normalize_data_sources(args.data_sources)

    print(f"[info] backend_root={BACKEND_ROOT}")
    print("[info] database=loaded from backend/.env")
    print(f"[info] embedding_model={settings.rag_embedding_model}")

    if args.full_scan:
        return run_full_scan(args)

    probe_db = SessionLocal()
    try:
        candidates = find_resume_candidates(
            probe_db,
            source_id_min=args.source_id_min,
            source_id_max=args.source_id_max,
            data_sources=data_sources,
            limit=args.limit,
        )
    finally:
        probe_db.close()

    if not candidates:
        print("[done] 没查到缺失/失败/异常的 source。")
        print("[tip] 如果你改过 content，想按最新内容补同步，请加 --full-scan 再跑一次。")
        return 0

    status_counter = Counter(candidate.sync_status for candidate in candidates)
    source_ids = [candidate.source_id for candidate in candidates]

    print(
        f"[info] 找到待处理 source {len(source_ids)} 条，"
        f"id范围={source_ids[0]}~{source_ids[-1]}，"
        f"状态分布={dict(status_counter)}"
    )
    preview = ", ".join(str(value) for value in source_ids[:10])
    print(f"[info] 前 10 个 source_id: {preview}")

    if args.dry_run:
        print("[dry-run] 未执行任何 embedding。")
        return 0

    total_success = 0
    total_fail = 0
    total_skipped = 0
    batches = list(_chunked(source_ids, args.batch_size))

    for index, batch_source_ids in enumerate(batches, start=1):
        print(f"[batch] {index}/{len(batches)} 开始，数量={len(batch_source_ids)}")
        success_count, fail_count, skipped_count = run_single_batch(batch_source_ids)
        total_success += success_count
        total_fail += fail_count
        total_skipped += skipped_count

    print(
        f"[summary] 批次完成：success={total_success} fail={total_fail} skipped={total_skipped}"
    )
    if total_fail > 0:
        print("[warn] 还有失败项，直接重新运行同一条命令即可继续补跑失败项。")
    else:
        print("[done] 当前查到的未完成/异常项已处理完。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
