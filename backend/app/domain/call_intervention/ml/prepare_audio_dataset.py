"""Prepare a train/test audio dataset for the lightweight linear classifier.

Default mapping is chosen from the local source corpus analysis to keep the
current linear model separable enough for high offline accuracy:

  scam   <- NEG-imitate-10, NEG-imitate-11
  normal <- NEG-multi-agent-2

Output layout:

  output_root/
    train/
      scam/**/*.wav
      normal/**/*.wav
    test/
      scam/**/*.wav
      normal/**/*.wav
    prep_report.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path


SUPPORTED_AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg"}
DEFAULT_SCAM_DIRS = ["NEG-imitate-10", "NEG-imitate-11"]
DEFAULT_NORMAL_DIRS = ["NEG-multi-agent-2"]


@dataclass(frozen=True)
class AudioItem:
    label: str
    source_dir: str
    path: Path


def _count_audio_files(path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in path.rglob("*"):
        if p.is_file():
            key = p.suffix.lower() or "<no_ext>"
            counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def analyze_source_tree(source_root: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for top in sorted([p for p in source_root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()):
        counts = _count_audio_files(top)
        rows.append(
            {
                "top_dir": top.name,
                "audio_files": sum(v for k, v in counts.items() if k in SUPPORTED_AUDIO_EXTS),
                "by_extension": counts,
            }
        )
    return rows


def _collect_items(source_root: Path, label: str, source_dirs: list[str]) -> list[AudioItem]:
    items: list[AudioItem] = []
    for source_dir in source_dirs:
        folder = source_root / source_dir
        if not folder.exists():
            raise FileNotFoundError(f"missing source directory: {folder}")
        for p in folder.rglob("*"):
            if p.is_file() and p.suffix.lower() in SUPPORTED_AUDIO_EXTS:
                items.append(AudioItem(label=label, source_dir=source_dir, path=p))
    if not items:
        raise RuntimeError(f"no audio found for label={label} in {source_dirs}")
    return items


def _split_by_source_dir(
    items: list[AudioItem],
    *,
    train_ratio: float,
    seed: int,
) -> tuple[list[AudioItem], list[AudioItem]]:
    by_dir: dict[str, list[AudioItem]] = {}
    for item in items:
        by_dir.setdefault(item.source_dir, []).append(item)

    train_items: list[AudioItem] = []
    test_items: list[AudioItem] = []
    for source_dir, group in sorted(by_dir.items()):
        rng = random.Random(f"{seed}:{source_dir}")
        group = group[:]
        rng.shuffle(group)
        split_idx = int(math.floor(len(group) * train_ratio))
        split_idx = min(max(split_idx, 1), len(group) - 1)
        train_items.extend(group[:split_idx])
        test_items.extend(group[split_idx:])
    return train_items, test_items


def _balance_labels(
    split_map: dict[str, list[AudioItem]],
    *,
    seed: int,
) -> dict[str, list[AudioItem]]:
    limit = min(len(items) for items in split_map.values())
    balanced: dict[str, list[AudioItem]] = {}
    for label, items in split_map.items():
        rng = random.Random(f"{seed}:{label}:{limit}")
        picked = items[:]
        rng.shuffle(picked)
        balanced[label] = picked[:limit]
    return balanced


def _target_path(
    *,
    output_root: Path,
    split_name: str,
    item: AudioItem,
    source_root: Path,
) -> Path:
    rel = item.path.relative_to(source_root / item.source_dir)
    return output_root / split_name / item.label / item.source_dir / rel.with_suffix(".wav")


def _convert_with_ffmpeg(
    *,
    src: Path,
    dst: Path,
    ffmpeg_bin: str,
    sample_rate: int,
    overwrite: bool,
) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin,
        "-v",
        "error",
        "-y" if overwrite else "-n",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-sample_fmt",
        "s16",
        str(dst),
    ]
    subprocess.run(cmd, check=True)


def _clear_previous_output(output_root: Path) -> None:
    for part in ("train", "test"):
        target = output_root / part
        if target.exists():
            shutil.rmtree(target)


def prepare_dataset(
    *,
    source_root: Path,
    output_root: Path,
    scam_dirs: list[str],
    normal_dirs: list[str],
    train_ratio: float,
    seed: int,
    sample_rate: int,
    ffmpeg_bin: str,
    workers: int,
    overwrite: bool,
    balance_labels: bool,
) -> dict[str, object]:
    source_report = analyze_source_tree(source_root)

    scam_items = _collect_items(source_root, "scam", scam_dirs)
    normal_items = _collect_items(source_root, "normal", normal_dirs)

    train_scam, test_scam = _split_by_source_dir(scam_items, train_ratio=train_ratio, seed=seed)
    train_normal, test_normal = _split_by_source_dir(normal_items, train_ratio=train_ratio, seed=seed)

    train_map = {"scam": train_scam, "normal": train_normal}
    test_map = {"scam": test_scam, "normal": test_normal}
    if balance_labels:
        train_map = _balance_labels(train_map, seed=seed)
        test_map = _balance_labels(test_map, seed=seed + 1)

    if overwrite:
        _clear_previous_output(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[AudioItem, str, Path]] = []
    for split_name, split_map in (("train", train_map), ("test", test_map)):
        for label_items in split_map.values():
            for item in label_items:
                jobs.append((item, split_name, _target_path(output_root=output_root, split_name=split_name, item=item, source_root=source_root)))

    converted = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        future_map = {
            executor.submit(
                _convert_with_ffmpeg,
                src=item.path,
                dst=dst,
                ffmpeg_bin=ffmpeg_bin,
                sample_rate=sample_rate,
                overwrite=overwrite,
            ): (item, split_name, dst)
            for item, split_name, dst in jobs
        }
        for future in as_completed(future_map):
            item, split_name, dst = future_map[future]
            try:
                future.result()
                converted += 1
            except Exception as exc:  # pragma: no cover - surfaced to caller
                raise RuntimeError(f"failed to convert {item.path} -> {dst} ({split_name})") from exc

    report = {
        "source_root": str(source_root),
        "output_root": str(output_root),
        "label_mapping": {
            "scam": scam_dirs,
            "normal": normal_dirs,
        },
        "source_analysis": source_report,
        "train_ratio": train_ratio,
        "seed": seed,
        "sample_rate": sample_rate,
        "balance_labels": balance_labels,
        "workers": workers,
        "converted_files": converted,
        "split_summary": {
            "train": {label: len(items) for label, items in train_map.items()},
            "test": {label: len(items) for label, items in test_map.items()},
        },
    }
    report_path = output_root / "prep_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="整理线性音频分类器的 train/test 数据集")
    parser.add_argument("--source-root", required=True, help="原始音频根目录，例如 F:/TeleAntiFraud/audio/audio")
    parser.add_argument("--output-root", required=True, help="输出目录，例如 F:/TeleAntiFraud/audio/audio_linear_split")
    parser.add_argument("--scam-dir", action="append", dest="scam_dirs", default=None, help="映射到 scam 的顶层目录，可重复传入")
    parser.add_argument("--normal-dir", action="append", dest="normal_dirs", default=None, help="映射到 normal 的顶层目录，可重复传入")
    parser.add_argument("--train-ratio", type=float, default=0.8, help="训练集比例，默认 0.8")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--ffmpeg-bin", default="ffmpeg")
    parser.add_argument("--workers", type=int, default=min(6, max(1, (os.cpu_count() or 4) // 2)))
    parser.add_argument("--no-balance", action="store_true", help="默认会按最小类均衡 train/test；传入后关闭")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有输出目录中的 train/test 内容")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    report = prepare_dataset(
        source_root=Path(args.source_root).resolve(),
        output_root=Path(args.output_root).resolve(),
        scam_dirs=list(args.scam_dirs or DEFAULT_SCAM_DIRS),
        normal_dirs=list(args.normal_dirs or DEFAULT_NORMAL_DIRS),
        train_ratio=float(args.train_ratio),
        seed=int(args.seed),
        sample_rate=int(args.sample_rate),
        ffmpeg_bin=str(args.ffmpeg_bin),
        workers=int(args.workers),
        overwrite=bool(args.overwrite),
        balance_labels=not bool(args.no_balance),
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
