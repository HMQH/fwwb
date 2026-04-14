"""CLI entrypoint for the RAG ingestion worker."""
from __future__ import annotations

import argparse
import logging
import time

from app.domain.rag import service as rag_service
from app.shared.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the RAG ingestion worker")
    parser.add_argument("--once", action="store_true", help="Process at most one pending job and exit")
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=settings.rag_worker_poll_seconds,
        help="Polling interval when running continuously",
    )
    args = parser.parse_args()

    if args.once:
        job = rag_service.process_next_pending_job()
        if job is None:
            logger.info("No pending RAG jobs found")
        else:
            logger.info("Processed RAG job %s with status=%s", job.id, job.status)
        return

    logger.info("Starting RAG worker loop with poll interval %ss", args.poll_seconds)
    while True:
        job = rag_service.process_next_pending_job()
        if job is None:
            time.sleep(max(1, args.poll_seconds))
            continue
        logger.info("Processed RAG job %s with status=%s", job.id, job.status)


if __name__ == "__main__":
    main()

