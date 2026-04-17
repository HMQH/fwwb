"""Evaluate the lightweight linear audio classifier on a wav dataset."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .features import extract_feature_vector
from .linear_model import LinearAudioFraudClassifier
from .train_linear_classifier import _metrics, _read_wav_mono, _scan_default_layout


def evaluate_dataset(
    *,
    dataset_root: Path,
    model_path: Path,
) -> dict[str, float | int]:
    model = LinearAudioFraudClassifier.from_json_file(model_path)
    if not model.enabled:
        raise RuntimeError(f"模型不可用: {model_path}")

    samples = [s for s in _scan_default_layout(dataset_root) if s.path.exists()]
    if not samples:
        raise RuntimeError(f"未在 {dataset_root} 找到 scam/normal wav 数据")

    y_true: list[int] = []
    probs: list[float] = []
    for sample in samples:
        waveform = _read_wav_mono(sample.path, target_sr=model.sample_rate)
        if waveform.size < int(model.sample_rate * 0.5):
            continue
        feature_vec = extract_feature_vector(waveform, sample_rate=model.sample_rate)
        probs.append(model.predict_proba(feature_vec))
        y_true.append(sample.label)

    if not probs:
        raise RuntimeError("测试集中没有可用音频")

    y = np.asarray(y_true, dtype=np.float32)
    p = np.asarray(probs, dtype=np.float32)
    metrics = _metrics(p, y, model.threshold)
    pred = (p >= model.threshold).astype(np.int32)
    tp = int(np.sum((pred == 1) & (y == 1)))
    tn = int(np.sum((pred == 0) & (y == 0)))
    fp = int(np.sum((pred == 1) & (y == 0)))
    fn = int(np.sum((pred == 0) & (y == 1)))
    return {
        "samples": int(y.size),
        "scam_samples": int(np.sum(y == 1)),
        "normal_samples": int(np.sum(y == 0)),
        "threshold": float(model.threshold),
        "accuracy": float(metrics["accuracy"]),
        "precision": float(metrics["precision"]),
        "recall": float(metrics["recall"]),
        "f1": float(metrics["f1"]),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="评估线性音频分类器在测试集上的表现")
    parser.add_argument("--dataset-root", required=True, help="测试集根目录，例如 F:/.../audio_linear_split/test")
    parser.add_argument("--model", required=True, help="模型 JSON 路径")
    parser.add_argument("--min-accuracy", type=float, default=None, help="若准确率低于此值则返回非 0")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    result = evaluate_dataset(
        dataset_root=Path(args.dataset_root).resolve(),
        model_path=Path(args.model).resolve(),
    )
    print(json.dumps(result, ensure_ascii=False))
    if args.min_accuracy is not None and float(result["accuracy"]) < float(args.min_accuracy):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
