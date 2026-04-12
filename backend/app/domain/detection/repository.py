"""检测提交持久化。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.domain.detection.entity import DetectionSubmission


def save_submission(db: Session, row: DetectionSubmission) -> DetectionSubmission:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
