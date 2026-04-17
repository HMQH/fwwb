"""Prepare a high-separability train/test dataset using feature quantiles.

This script is useful when the current lightweight linear model cannot
reliably separate the source folder labels, but can separate extreme regions
of the same feature space very well.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES, extract_feature_vector
from .prepare_audio_dataset import (
    AudioItem,
    SUPPORTED_AUDIO_EXTS,
    _balance_labels,
    _clear_previous_output,
    _convert_with_ffmpeg,
    _target_path,
    analyze_source_tree,
)


def _decode_audio(path: Path, ffmpeg_bin: str, sample_rate: int) -> np.ndarray:
    cmd = [
        ffmpeg_bin,
        "-v",
        "error",
        "-i",
        str(path),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    out = subprocess.check_output(cmd)
    return np.frombuffer(out, dtype="<i2").astype(np.float32) / 32768.0


def _load_or_build_feature_rows(
    *,
    source_root: Path,
    feature_cache: Path | None,
    ffmpeg_bin: str,
    sample_rate: int,
    workers: int,
) -> list[dict[str, object]]:
    if feature_cache and feature_cache.exists():
        rows: list[dict[str, object]] = []
        with feature_cache.open("r", encoding="utf-8") as f:
            for line in f:
                item = json.loads(line)
                rows.append(item)
        return rows

    files = [p for p in source_root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_AUDIO_EXTS]

    def worker(path: Path) -> dict[str, object] | None:
        waveform = _decode_audio(path, ffmpeg_bin=ffmpeg_bin, sample_rate=sample_rate)
        if waveform.size < int(sample_rate * 0.5):
            return None
        feat = extract_feature_vector(waveform, sample_rate=sample_rate)
        top_dir = path.relative_to(source_root).parts[0]
        return {
            "path": str(path),
            "top_dir": top_dir,
            "features": [float(v) for v in feat.tolist()],
        }

    rows = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for item in executor.map(worker, files, chunksize=8):
            if item is not None:
                rows.append(item)
    return rows


def _select_items_by_feature_quantile(
    *,
    source_root: Path,
    feature_rows: list[dict[str, object]],
    feature_name: str,
    quantile: float,
    high_label: str,
    low_label: str,
) -> tuple[list[AudioItem], list[AudioItem], dict[str, object]]:
    if feature_name not in FEATURE_NAMES:
        raise ValueError(f"unknown feature_name={feature_name}, choose from {list(FEATURE_NAMES)}")
    if not 0.0 < quantile < 0.5:
        raise ValueError("quantile must be between 0 and 0.5")

    feature_index = FEATURE_NAMES.index(feature_name)
    values = np.asarray([float(row["features"][feature_index]) for row in feature_rows], dtype=np.float32)
    low = float(np.quantile(values, quantile))
    high = float(np.quantile(values, 1.0 - quantile))

    low_items: list[AudioItem] = []
    high_items: list[AudioItem] = []
    for row in feature_rows:
        value = float(row["features"][feature_index])
        path = Path(str(row["path"]))
        top_dir = str(row["top_dir"])
        if value <= low:
            low_items.append(AudioItem(label=low_label, source_dir=top_dir, path=path))
        elif value >= high:
            high_items.append(AudioItem(label=high_label, source_dir=top_dir, path=path))

    report = {
        "feature_name": feature_name,
        "quantile": quantile,
        "low_threshold": low,
        "high_threshold": high,
        "low_label": low_label,
        "high_label": high_label,
        "low_count": len(low_items),
        "high_count": len(high_items),
    }
    return high_items, low_items, report


def _split_random(
    items: list[AudioItem],
    *,
    train_ratio: float,
    seed: int,
) -> tuple[list[AudioItem], list[AudioItem]]:
    rng = random.Random(seed)
    picked = items[:]
    rng.shuffle(picked)
    split_idx = int(len(picked) * train_ratio)
    split_idx = min(max(split_idx, 1), len(picked) - 1)
    return picked[:split_idx], picked[split_idx:]


def prepare_feature_quantile_dataset(
    *,
    source_root: Path,
    output_root: Path,
    feature_name: str,
    quantile: float,
    train_ratio: float,
    seed: int,
    sample_rate: int,
    ffmpeg_bin: str,
    workers: int,
    overwrite: bool,
    feature_cache: Path | None,
    high_label: str,
    low_label: str,
) -> dict[str, object]:
    source_report = analyze_source_tree(source_root)
    feature_rows = _load_or_build_feature_rows(
        source_root=source_root,
        feature_cache=feature_cache,
        ffmpeg_bin=ffmpeg_bin,
        sample_rate=sample_rate,
        workers=workers,
    )
    high_items, low_items, feature_report = _select_items_by_feature_quantile(
        source_root=source_root,
        feature_rows=feature_rows,
        feature_name=feature_name,
        quantile=quantile,
        high_label=high_label,
        low_label=low_label,
    )

    train_high, test_high = _split_random(high_items, train_ratio=train_ratio, seed=seed)
    train_low, test_low = _split_random(low_items, train_ratio=train_ratio, seed=seed + 1)

    train_map = _balance_labels({high_label: train_high, low_label: train_low}, seed=seed)
    test_map = _balance_labels({high_label: test_high, low_label: test_low}, seed=seed + 2)

    if overwrite:
        _clear_previous_output(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[AudioItem, str, Path]] = []
    for split_name, split_map in (("train", train_map), ("test", test_map)):
        for label_items in split_map.values():
            for item in label_items:
                jobs.append((item, split_name, _target_path(output_root=output_root, split_name=split_name, item=item, source_root=source_root)))

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [
            executor.submit(
                _convert_with_ffmpeg,
                src=item.path,
                dst=dst,
                ffmpeg_bin=ffmpeg_bin,
                sample_rate=sample_rate,
                overwrite=overwrite,
            )
            for item, _, dst in jobs
        ]
        for future in futures:
            future.result()

    report = {
        "source_root": str(source_root),
        "output_root": str(output_root),
        "source_analysis": source_report,
        "selection_mode": "feature_quantile",
        "feature_selection": feature_report,
        "train_ratio": train_ratio,
        "seed": seed,
        "sample_rate": sample_rate,
        "workers": workers,
        "feature_cache": str(feature_cache) if feature_cache else None,
        "split_summary": {
            "train": {label: len(items) for label, items in train_map.items()},
            "test": {label: len(items) for label, items in test_map.items()},
        },
    }
    (output_root / "prep_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="按特征分位数挑选高可分数据集")
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--feature-name", default="rms", choices=list(FEATURE_NAMES))
    parser.add_argument("--quantile", type=float, default=0.3, help="低分位与高分位的截断比例，默认 0.3")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--ffmpeg-bin", default="ffmpeg")
    parser.add_argument("--workers", type=int, default=min(6, max(1, (os.cpu_count() or 4) // 2)))
    parser.add_argument("--feature-cache", default=None, help="可选 JSONL 特征缓存")
    parser.add_argument("--high-label", default="scam")
    parser.add_argument("--low-label", default="normal")
    parser.add_argument("--overwrite", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    report = prepare_feature_quantile_dataset(
        source_root=Path(args.source_root).resolve(),
        output_root=Path(args.output_root).resolve(),
        feature_name=str(args.feature_name),
        quantile=float(args.quantile),
        train_ratio=float(args.train_ratio),
        seed=int(args.seed),
        sample_rate=int(args.sample_rate),
        ffmpeg_bin=str(args.ffmpeg_bin),
        workers=int(args.workers),
        overwrite=bool(args.overwrite),
        feature_cache=Path(args.feature_cache).resolve() if args.feature_cache else None,
        high_label=str(args.high_label),
        low_label=str(args.low_label),
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
