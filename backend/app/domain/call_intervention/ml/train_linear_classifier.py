"""Train a lightweight linear fraud-audio classifier.

Default dataset layout:

  dataset_root/
    scam/**/*.wav
    normal/**/*.wav

A manifest is also supported:
- csv: path,label
- jsonl: {"path": "...", "label": "scam|normal"}
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES, extract_feature_vector


POSITIVE_LABELS = {"scam", "fraud", "positive", "1", "true"}
NEGATIVE_LABELS = {"normal", "benign", "negative", "0", "false"}


@dataclass
class Sample:
    path: Path
    label: int


def _normalize_label(raw: str) -> int:
    v = raw.strip().lower()
    if v in POSITIVE_LABELS:
        return 1
    if v in NEGATIVE_LABELS:
        return 0
    raise ValueError(f"unknown label: {raw}")


def _resample_linear(x: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr or x.size == 0:
        return x.astype(np.float32)
    duration = x.size / float(src_sr)
    dst_n = max(1, int(round(duration * dst_sr)))
    old_t = np.linspace(0.0, duration, num=x.size, endpoint=False)
    new_t = np.linspace(0.0, duration, num=dst_n, endpoint=False)
    return np.interp(new_t, old_t, x).astype(np.float32)


def _read_wav_mono(path: Path, target_sr: int = 16000) -> np.ndarray:
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        src_sr = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sample_width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / float(2**31)
    else:
        raise ValueError(f"unsupported sample width: {sample_width} at {path}")

    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)

    return _resample_linear(data, src_sr, target_sr)


def _scan_default_layout(dataset_root: Path) -> list[Sample]:
    pairs: list[Sample] = []
    for p in dataset_root.rglob("*.wav"):
        lower_parts = {part.lower() for part in p.parts}
        if lower_parts & {"scam", "fraud"}:
            pairs.append(Sample(path=p, label=1))
        elif lower_parts & {"normal", "benign"}:
            pairs.append(Sample(path=p, label=0))
    return pairs


def _load_manifest(dataset_root: Path, manifest_path: Path) -> list[Sample]:
    rows: list[Sample] = []
    if manifest_path.suffix.lower() == ".csv":
        with manifest_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rel = (row.get("path") or "").strip()
                label = _normalize_label(row.get("label") or "")
                rows.append(Sample(path=(dataset_root / rel).resolve(), label=label))
        return rows

    if manifest_path.suffix.lower() in {".jsonl", ".json"}:
        with manifest_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                item = json.loads(line)
                rel = str(item.get("path", "")).strip()
                label = _normalize_label(str(item.get("label", "")))
                rows.append(Sample(path=(dataset_root / rel).resolve(), label=label))
        return rows

    raise ValueError("manifest 仅支持 .csv 或 .jsonl/.json")


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def _fit_logistic_regression(
    x: np.ndarray,
    y: np.ndarray,
    *,
    epochs: int,
    lr: float,
    l2: float,
) -> tuple[np.ndarray, float]:
    w = np.zeros((x.shape[1],), dtype=np.float32)
    b = 0.0
    n = float(x.shape[0])

    for _ in range(max(1, epochs)):
        logits = x @ w + b
        probs = _sigmoid(logits)
        diff = probs - y
        grad_w = (x.T @ diff) / n + l2 * w
        grad_b = float(np.mean(diff))
        w -= lr * grad_w
        b -= lr * grad_b

    return w.astype(np.float32), float(b)


def _metrics(probs: np.ndarray, y: np.ndarray, threshold: float) -> dict[str, float]:
    pred = (probs >= threshold).astype(np.int32)
    tp = int(np.sum((pred == 1) & (y == 1)))
    tn = int(np.sum((pred == 0) & (y == 0)))
    fp = int(np.sum((pred == 1) & (y == 0)))
    fn = int(np.sum((pred == 0) & (y == 1)))

    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = (2 * precision * recall) / max(1e-8, precision + recall)
    acc = (tp + tn) / max(1, y.size)
    return {
        "accuracy": float(acc),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
    }


def _find_best_threshold(probs: np.ndarray, y: np.ndarray) -> float:
    best_t = 0.82
    best_f1 = -1.0
    for t in np.linspace(0.3, 0.95, num=66):
        f1 = _metrics(probs, y, float(t))["f1"]
        if f1 > best_f1:
            best_f1 = f1
            best_t = float(t)
    return best_t


def run_training(
    *,
    dataset_root: Path,
    output_path: Path,
    manifest_path: Path | None,
    val_ratio: float,
    seed: int,
    epochs: int,
    lr: float,
    l2: float,
    sample_rate: int,
) -> None:
    if manifest_path is None:
        samples = _scan_default_layout(dataset_root)
    else:
        samples = _load_manifest(dataset_root, manifest_path)

    samples = [s for s in samples if s.path.exists()]
    if len(samples) < 20:
        raise RuntimeError("有效样本不足，至少需要 20 条音频")

    random.Random(seed).shuffle(samples)
    x_list: list[np.ndarray] = []
    y_list: list[int] = []
    for s in samples:
        try:
            waveform = _read_wav_mono(s.path, target_sr=sample_rate)
            if waveform.size < int(sample_rate * 0.5):
                continue
            x_list.append(extract_feature_vector(waveform, sample_rate=sample_rate))
            y_list.append(s.label)
        except Exception:
            continue

    if len(x_list) < 20:
        raise RuntimeError("可用于训练的样本不足，至少需要 20 条可读音频")

    x = np.stack(x_list).astype(np.float32)
    y = np.asarray(y_list, dtype=np.float32)

    split_idx = int((1.0 - val_ratio) * x.shape[0])
    split_idx = min(max(split_idx, 1), x.shape[0] - 1)
    x_train, x_val = x[:split_idx], x[split_idx:]
    y_train, y_val = y[:split_idx], y[split_idx:]

    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std = np.where(std <= 1e-8, 1.0, std).astype(np.float32)

    x_train_n = (x_train - mean) / std
    x_val_n = (x_val - mean) / std

    w, b = _fit_logistic_regression(x_train_n, y_train, epochs=epochs, lr=lr, l2=l2)
    val_probs = _sigmoid(x_val_n @ w + b)
    threshold = _find_best_threshold(val_probs, y_val)
    metric = _metrics(val_probs, y_val, threshold)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": "1",
        "type": "audio_linear_classifier",
        "feature_names": list(FEATURE_NAMES),
        "weights": [float(v) for v in w.tolist()],
        "bias": float(b),
        "mean": [float(v) for v in mean.tolist()],
        "std": [float(v) for v in std.tolist()],
        "threshold": float(threshold),
        "sample_rate": int(sample_rate),
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "train_size": int(x_train.shape[0]),
        "val_size": int(x_val.shape[0]),
        "metrics": metric,
        "enabled": True,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"saved_to": str(output_path), **metric}, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="训练通话诈骗音频线性层判别器")
    parser.add_argument("--dataset-root", required=True, help="数据集根目录，例如 F:/fraud_audio_dataset")
    parser.add_argument("--output", required=True, help="输出模型 JSON 文件路径")
    parser.add_argument("--manifest", default=None, help="可选 manifest(.csv/.jsonl)")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=400)
    parser.add_argument("--lr", type=float, default=0.05)
    parser.add_argument("--l2", type=float, default=1e-4)
    parser.add_argument("--sample-rate", type=int, default=16000)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run_training(
        dataset_root=Path(args.dataset_root).resolve(),
        output_path=Path(args.output).resolve(),
        manifest_path=Path(args.manifest).resolve() if args.manifest else None,
        val_ratio=float(args.val_ratio),
        seed=int(args.seed),
        epochs=int(args.epochs),
        lr=float(args.lr),
        l2=float(args.l2),
        sample_rate=int(args.sample_rate),
    )


if __name__ == "__main__":
    main()
