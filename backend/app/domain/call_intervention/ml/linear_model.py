"""Linear classifier load and inference helpers."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = np.exp(-x)
        return float(1.0 / (1.0 + z))
    z = np.exp(x)
    return float(z / (1.0 + z))


def resolve_model_path(path: str) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    return (Path.cwd() / p).resolve()


@dataclass
class LinearAudioFraudClassifier:
    enabled: bool
    weights: np.ndarray
    bias: float
    mean: np.ndarray
    std: np.ndarray
    threshold: float
    sample_rate: int
    source_path: str | None = None

    @classmethod
    def disabled(cls) -> "LinearAudioFraudClassifier":
        d = len(FEATURE_NAMES)
        return cls(
            enabled=False,
            weights=np.zeros((d,), dtype=np.float32),
            bias=0.0,
            mean=np.zeros((d,), dtype=np.float32),
            std=np.ones((d,), dtype=np.float32),
            threshold=0.82,
            sample_rate=16000,
            source_path=None,
        )

    @classmethod
    def from_json_file(cls, path: str | Path) -> "LinearAudioFraudClassifier":
        model_path = resolve_model_path(str(path))
        if not model_path.exists():
            return cls.disabled()

        payload = json.loads(model_path.read_text(encoding="utf-8"))
        weights = np.asarray(payload.get("weights", []), dtype=np.float32)
        mean = np.asarray(payload.get("mean", []), dtype=np.float32)
        std = np.asarray(payload.get("std", []), dtype=np.float32)

        dim = len(FEATURE_NAMES)
        if weights.size != dim or mean.size != dim or std.size != dim:
            return cls.disabled()

        std = np.where(std <= 1e-8, 1.0, std).astype(np.float32)
        return cls(
            enabled=bool(payload.get("enabled", True)),
            weights=weights,
            bias=float(payload.get("bias", 0.0)),
            mean=mean,
            std=std,
            threshold=float(payload.get("threshold", 0.82)),
            sample_rate=int(payload.get("sample_rate", 16000)),
            source_path=str(model_path),
        )

    def predict_proba(self, feature_vec: np.ndarray) -> float:
        if not self.enabled:
            return 0.0
        x = (feature_vec.astype(np.float32) - self.mean) / self.std
        score = float(np.dot(self.weights, x) + self.bias)
        return _sigmoid(score)
