from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class EvidenceItem:
    skill: str
    title: str
    detail: str
    severity: str = "info"
    source_path: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "skill": self.skill,
            "title": self.title,
            "detail": self.detail,
            "severity": self.severity,
        }
        if self.source_path:
            payload["source_path"] = self.source_path
        if self.extra:
            payload["extra"] = self.extra
        return payload


@dataclass(slots=True)
class SkillResult:
    name: str
    status: str = "completed"
    summary: str = ""
    triggered: bool = False
    risk_score: float = 0.0
    labels: list[str] = field(default_factory=list)
    evidence: list[EvidenceItem] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "summary": self.summary,
            "triggered": self.triggered,
            "risk_score": round(max(0.0, min(1.0, float(self.risk_score or 0.0))), 4),
            "labels": list(self.labels),
            "evidence": [item.to_dict() for item in self.evidence],
            "recommendations": list(self.recommendations),
            "raw": dict(self.raw),
        }

