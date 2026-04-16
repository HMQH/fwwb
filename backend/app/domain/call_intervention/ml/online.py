"""Online audio fraud judgment on streaming PCM chunks."""
from __future__ import annotations

from dataclasses import dataclass
from time import monotonic

import numpy as np

from app.shared.core.config import settings

from .features import extract_feature_vector, pcm16le_to_float32
from .linear_model import LinearAudioFraudClassifier


@dataclass(frozen=True)
class AudioFraudDecision:
    probability: float
    threshold: float
    rule_code: str
    message: str
    window_ms: int


class OnlineAudioFraudJudge:
    def __init__(
        self,
        *,
        classifier: LinearAudioFraudClassifier,
        window_seconds: float,
        eval_chunk_interval: int,
        min_positive_streak: int,
        cooldown_seconds: float,
    ) -> None:
        self.classifier = classifier
        self.window_samples = max(1600, int(classifier.sample_rate * window_seconds))
        self.eval_chunk_interval = max(1, eval_chunk_interval)
        self.min_positive_streak = max(1, min_positive_streak)
        self.cooldown_seconds = max(0.0, cooldown_seconds)

        self._buffer = np.zeros((0,), dtype=np.float32)
        self._chunk_index = 0
        self._streak = 0
        self._smoothed_prob = 0.0
        self._last_emit_at = 0.0

    def push(self, audio_chunk: bytes) -> AudioFraudDecision | None:
        chunk = pcm16le_to_float32(audio_chunk)
        if chunk.size == 0:
            return None

        self._chunk_index += 1
        self._buffer = np.concatenate((self._buffer, chunk), dtype=np.float32)
        if self._buffer.size > self.window_samples:
            self._buffer = self._buffer[-self.window_samples :]

        if self._chunk_index % self.eval_chunk_interval != 0:
            return None
        if self._buffer.size < min(self.window_samples, self.classifier.sample_rate):
            return None

        feats = extract_feature_vector(self._buffer, sample_rate=self.classifier.sample_rate)
        prob = self.classifier.predict_proba(feats)
        self._smoothed_prob = 0.35 * prob + 0.65 * self._smoothed_prob

        if self._smoothed_prob >= self.classifier.threshold:
            self._streak += 1
        else:
            self._streak = max(0, self._streak - 1)

        now = monotonic()
        if self._streak < self.min_positive_streak:
            return None
        if (now - self._last_emit_at) < self.cooldown_seconds:
            return None

        self._last_emit_at = now
        return AudioFraudDecision(
            probability=float(self._smoothed_prob),
            threshold=float(self.classifier.threshold),
            rule_code="audio_linear_classifier_high",
            message="检测到疑似诈骗语音特征，请提醒用户立即核验身份并尽快挂断。",
            window_ms=int(self._buffer.size * 1000 / self.classifier.sample_rate),
        )


def create_online_audio_fraud_judge() -> OnlineAudioFraudJudge | None:
    if not settings.audio_linear_enable:
        return None

    classifier = LinearAudioFraudClassifier.from_json_file(settings.audio_linear_model_path)
    if not classifier.enabled:
        return None

    return OnlineAudioFraudJudge(
        classifier=classifier,
        window_seconds=settings.audio_linear_window_seconds,
        eval_chunk_interval=settings.audio_linear_eval_chunk_interval,
        min_positive_streak=settings.audio_linear_min_positive_streak,
        cooldown_seconds=settings.audio_linear_cooldown_seconds,
    )
