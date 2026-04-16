from __future__ import annotations

import librosa
import numpy as np
import soundfile as sf

TARGET_SR = 16000
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 400
N_MELS = 64
N_MFCC = 20
FEATURE_VERSION = "add_full_v2"
EPS = 1e-6


def load_audio(path: str, target_sr: int = TARGET_SR) -> np.ndarray:
    try:
        x, sr = sf.read(path)
        if x.ndim > 1:
            x = x.mean(axis=1)
        x = x.astype(np.float32)
        if sr != target_sr:
            x = librosa.resample(x, orig_sr=sr, target_sr=target_sr)
    except Exception:
        x, _ = librosa.load(path, sr=target_sr, mono=True)
        x = x.astype(np.float32)

    x, _ = librosa.effects.trim(x, top_db=30)
    if len(x) < WIN_LENGTH:
        x = np.pad(x, (0, WIN_LENGTH - len(x)))
    return x.astype(np.float32)


def _summary_stats(arr: np.ndarray) -> list[float]:
    arr = np.asarray(arr, dtype=np.float32).reshape(-1)
    if arr.size == 0:
        arr = np.asarray([0.0], dtype=np.float32)
    q10, q50, q90 = np.percentile(arr, [10, 50, 90])
    return [
        float(arr.mean()),
        float(arr.std()),
        float(q10),
        float(q50),
        float(q90),
    ]


def _spectral_feature_block(x: np.ndarray) -> list[float]:
    feats: list[float] = []
    S = np.abs(
        librosa.stft(
            x,
            n_fft=N_FFT,
            hop_length=HOP_LENGTH,
            win_length=WIN_LENGTH,
        )
    ) + EPS
    power = S**2

    mel = librosa.feature.melspectrogram(
        S=power,
        sr=TARGET_SR,
        n_mels=N_MELS,
        fmax=TARGET_SR // 2,
    )
    logmel = librosa.power_to_db(mel, ref=np.max)
    mfcc = librosa.feature.mfcc(S=logmel, n_mfcc=N_MFCC)
    delta = librosa.feature.delta(mfcc)
    delta2 = librosa.feature.delta(mfcc, order=2)

    for arr in (logmel, mfcc, delta, delta2):
        feats.extend(arr.mean(axis=1).astype(np.float32).tolist())
        feats.extend(arr.std(axis=1).astype(np.float32).tolist())

    spectral_blocks = [
        librosa.feature.spectral_centroid(S=S, sr=TARGET_SR),
        librosa.feature.spectral_bandwidth(S=S, sr=TARGET_SR),
        librosa.feature.spectral_rolloff(S=S, sr=TARGET_SR),
        librosa.feature.spectral_flatness(S=S),
        librosa.feature.zero_crossing_rate(x, frame_length=WIN_LENGTH, hop_length=HOP_LENGTH),
        librosa.feature.rms(S=S, frame_length=N_FFT),
    ]
    for arr in spectral_blocks:
        feats.extend(_summary_stats(arr))

    mel_mean = logmel.mean(axis=1)
    mel_chunks = np.array_split(mel_mean, 8)
    feats.extend([float(chunk.mean()) for chunk in mel_chunks])

    fft_freqs = librosa.fft_frequencies(sr=TARGET_SR, n_fft=N_FFT)
    total_power = float(power.sum()) + EPS
    for lo, hi in ((0, 1000), (1000, 3000), (3000, 6000), (6000, 8000)):
        idx = np.where((fft_freqs >= lo) & (fft_freqs < hi))[0]
        feats.append(float(power[idx].sum() / total_power))

    avg_spec = np.log(power.mean(axis=1) + EPS)
    slope, intercept = np.polyfit(np.arange(len(avg_spec)), avg_spec, 1)
    feats.extend([float(slope), float(intercept)])
    return feats


def extract_features_from_waveform(x: np.ndarray) -> np.ndarray:
    feats: list[float] = []

    feats.extend(_summary_stats(x))
    abs_x = np.abs(x)
    feats.extend(_summary_stats(abs_x))

    centered = x - float(x.mean())
    std = float(centered.std()) + EPS
    z = centered / std
    feats.extend([float((z**3).mean()), float((z**4).mean())])

    feats.extend(_spectral_feature_block(x))

    mid = len(x) // 2
    window = min(len(x), TARGET_SR * 2)
    start = max(0, mid - window // 2)
    end = min(len(x), start + window)
    core = x[start:end]
    if len(core) < WIN_LENGTH:
        core = np.pad(core, (0, WIN_LENGTH - len(core)))
    core_feats = _spectral_feature_block(core)
    feats.extend(core_feats[:64])

    duration = len(x) / TARGET_SR
    feats.extend([float(duration), float(np.log1p(duration))])

    return np.asarray(feats, dtype=np.float32)


def extract_features(path: str) -> np.ndarray:
    return extract_features_from_waveform(load_audio(path))
