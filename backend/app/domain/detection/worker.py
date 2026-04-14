"""CLI entrypoint for detection jobs worker."""
from __future__ import annotations

import argparse
import logging
import time

from app.domain.detection import service as detection_service
from app.shared.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the detection worker")
    parser.add_argument("--once", action="store_true", help="Process at most one pending detection job and exit")
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=settings.detection_worker_poll_seconds,
        help="Polling interval when running continuously",
    )
    args = parser.parse_args()

    if args.once:
        job = detection_service.process_next_pending_job()
        if job is None:
            logger.info("No pending detection jobs found")
        else:
            logger.info("Processed detection job %s with status=%s", job.id, job.status)
        return

    logger.info("Starting detection worker loop with poll interval %ss", args.poll_seconds)
    while True:
        job = detection_service.process_next_pending_job()
        if job is None:
            time.sleep(max(1, args.poll_seconds))
            continue
        logger.info("Processed detection job %s with status=%s", job.id, job.status)


if __name__ == "__main__":
    main()
