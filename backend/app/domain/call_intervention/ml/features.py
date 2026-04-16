"""Audio feature extraction for the lightweight linear classifier."""
from __future__ import annotations

import math

import numpy as np

FEATURE_NAMES: tuple[str, ...] = (
    "rms",
    "abs_mean",
    "std",
    "max_abs",
    "zcr",
    "spec_centroid",
    "spec_bandwidth",
    "spec_rolloff85",
    "spec_flatness",
)


def pcm16le_to_float32(audio_bytes: bytes) -> np.ndarray:
    if not audio_bytes:
        return np.zeros((0,), dtype=np.float32)
    samples = np.frombuffer(audio_bytes, dtype="<i2").astype(np.float32)
    return samples / 32768.0


def extract_feature_vector(samples: np.ndarray, sample_rate: int = 16000) -> np.ndarray:
    if samples.size == 0:
        return np.zeros((len(FEATURE_NAMES),), dtype=np.float32)

    x = np.clip(samples.astype(np.float32), -1.0, 1.0)
    abs_x = np.abs(x)

    rms = float(np.sqrt(np.mean(x * x) + 1e-12))
    abs_mean = float(np.mean(abs_x))
    std = float(np.std(x))
    max_abs = float(np.max(abs_x))

    signs = np.signbit(x)
    zcr = float(np.mean(signs[1:] != signs[:-1])) if x.size > 1 else 0.0

    window = np.hanning(x.size).astype(np.float32)
    windowed = x * window
    spec = np.abs(np.fft.rfft(windowed)) + 1e-12
    freqs = np.fft.rfftfreq(x.size, d=1.0 / float(sample_rate))
    power = spec * spec
    power_sum = float(np.sum(power))
    if power_sum <= 1e-12:
        spec_centroid = 0.0
        spec_bandwidth = 0.0
        spec_rolloff = 0.0
    else:
        spec_centroid = float(np.sum(freqs * power) / power_sum)
        spec_bandwidth = float(np.sqrt(np.sum(((freqs - spec_centroid) ** 2) * power) / power_sum))
        cumsum = np.cumsum(power)
        roll_idx = int(np.searchsorted(cumsum, 0.85 * cumsum[-1], side="left"))
        spec_rolloff = float(freqs[min(roll_idx, freqs.size - 1)])

    geo = float(math.exp(np.mean(np.log(spec))))
    ari = float(np.mean(spec))
    spec_flatness = float(geo / (ari + 1e-12))

    return np.array(
        [
            rms,
            abs_mean,
            std,
            max_abs,
            zcr,
            spec_centroid / 8000.0,
            spec_bandwidth / 8000.0,
            spec_rolloff / 8000.0,
            spec_flatness,
        ],
        dtype=np.float32,
    )
