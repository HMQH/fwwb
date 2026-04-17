from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from torchvision.models import ResNet18_Weights, resnet18

from app.shared.core.config import settings

logger = logging.getLogger(__name__)

_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
_INDEX_VERSION = 2
_DEFAULT_TOP_K = 5
_EMBEDDING_BATCH_SIZE = 24
_MODEL_LOCK = Lock()
_INDEX_LOCK = Lock()
_FEATURE_MODEL: torch.nn.Module | None = None
_PREPROCESS = None
_REFERENCE_INDEX: "ReferenceIndex | None" = None
_REFERENCE_INDEX_KEY: tuple[str, str, int] | None = None


@dataclass(slots=True)
class ReferenceMatch:
    rank: int
    path: str
    label: str
    similarity: float


@dataclass(slots=True)
class ImageFraudCheckResult:
    filename: str
    score: float
    confidence: float
    risk_level: str
    is_fraud: bool
    need_manual_review: bool
    max_similarity: float
    mean_top_similarity: float
    centroid_similarity: float
    base_score: float
    feature_penalty: float
    review_threshold: float
    positive_threshold: float
    reference_count: int
    model_name: str
    matches: list[ReferenceMatch]
    visual_stats: dict[str, float]

    def as_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "score": self.score,
            "confidence": self.confidence,
            "risk_level": self.risk_level,
            "is_fraud": self.is_fraud,
            "need_manual_review": self.need_manual_review,
            "max_similarity": self.max_similarity,
            "mean_top_similarity": self.mean_top_similarity,
            "centroid_similarity": self.centroid_similarity,
            "base_score": self.base_score,
            "feature_penalty": self.feature_penalty,
            "review_threshold": self.review_threshold,
            "positive_threshold": self.positive_threshold,
            "reference_count": self.reference_count,
            "model_name": self.model_name,
            "visual_stats": dict(self.visual_stats),
            "matches": [
                {
                    "rank": item.rank,
                    "path": item.path,
                    "label": item.label,
                    "similarity": item.similarity,
                }
                for item in self.matches
            ],
        }


@dataclass(slots=True)
class ReferenceIndex:
    reference_dir: str
    fingerprint: str
    features: torch.Tensor
    centroid: torch.Tensor
    file_paths: list[str]
    file_labels: list[str]
    positive_threshold: float
    review_threshold: float
    positive_score_p10: float
    positive_score_mean: float
    stat_thresholds: dict[str, tuple[float, float]]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resolve_path(raw_path: str) -> Path:
    candidate = Path(raw_path).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (_repo_root() / candidate).resolve()


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(_repo_root()).as_posix()
    except ValueError:
        return path.as_posix()


def _iter_reference_paths(reference_dir: Path, *, limit: int) -> list[Path]:
    paths = sorted(
        [
            path
            for path in reference_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in _IMAGE_SUFFIXES
        ]
    )
    if limit > 0:
        return paths[:limit]
    return paths


def _build_fingerprint(paths: list[Path]) -> str:
    hasher = hashlib.sha256()
    for path in paths:
        stat = path.stat()
        hasher.update(path.name.encode("utf-8"))
        hasher.update(str(stat.st_size).encode("utf-8"))
        hasher.update(str(stat.st_mtime_ns).encode("utf-8"))
    return hasher.hexdigest()


def _image_label(path: Path) -> str:
    stem = path.stem
    if len(stem) <= 24:
        return stem
    return f"{stem[:24]}…"


def _compute_visual_stats(image: Image.Image) -> dict[str, float]:
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 80, 160)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    return {
        "edge_density": float((edges > 0).mean()),
        "saturation_mean": float(hsv[:, :, 1].mean() / 255.0),
        "intensity_std": float(gray.std() / 255.0),
    }


def _load_pil_from_path(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def _load_pil_from_bytes(image_bytes: bytes) -> Image.Image:
    from io import BytesIO

    with Image.open(BytesIO(image_bytes)) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def _get_feature_model() -> tuple[torch.nn.Module, Any]:
    global _FEATURE_MODEL, _PREPROCESS

    with _MODEL_LOCK:
        if _FEATURE_MODEL is not None and _PREPROCESS is not None:
            return _FEATURE_MODEL, _PREPROCESS

        weights = ResNet18_Weights.DEFAULT
        model = resnet18(weights=weights)
        model.fc = torch.nn.Identity()
        model.eval()
        _FEATURE_MODEL = model
        _PREPROCESS = weights.transforms()
        return _FEATURE_MODEL, _PREPROCESS


def _extract_features(images: list[Image.Image]) -> torch.Tensor:
    if not images:
        return torch.empty((0, 512), dtype=torch.float32)

    model, preprocess = _get_feature_model()
    batch = torch.stack([preprocess(image) for image in images])
    with torch.inference_mode():
        features = model(batch)
        if features.ndim == 1:
            features = features.unsqueeze(0)
        features = features.float().cpu()
    return F.normalize(features, dim=1)


def _score_reference_distribution(features: torch.Tensor) -> tuple[float, float, float, float]:
    if features.shape[0] <= 1:
        positive_threshold = max(0.74, float(settings.image_fraud_positive_floor))
        review_threshold = max(0.64, min(positive_threshold - 0.05, float(settings.image_fraud_review_floor)))
        return positive_threshold, review_threshold, positive_threshold, positive_threshold

    centroid = F.normalize(features.mean(dim=0, keepdim=True), dim=1)
    pairwise = features @ features.T
    pairwise.fill_diagonal_(-1.0)
    top_k = min(3, max(1, features.shape[0] - 1))
    top_values, _ = pairwise.topk(k=top_k, dim=1)
    centroid_scores = (features @ centroid.T).squeeze(1)
    positive_scores = 0.55 * top_values[:, 0] + 0.25 * top_values.mean(dim=1) + 0.20 * centroid_scores

    positive_score_p10 = float(torch.quantile(positive_scores, 0.10).item())
    positive_score_mean = float(positive_scores.mean().item())

    positive_threshold = max(
        float(settings.image_fraud_positive_floor),
        round(positive_score_p10 - 0.02, 4),
    )
    review_threshold = max(
        float(settings.image_fraud_review_floor),
        round(positive_threshold - 0.06, 4),
    )
    return positive_threshold, review_threshold, positive_score_p10, positive_score_mean


def _build_stat_thresholds(stats_list: list[dict[str, float]]) -> dict[str, tuple[float, float]]:
    if not stats_list:
        return {}

    thresholds: dict[str, tuple[float, float]] = {}
    for key in ("edge_density", "saturation_mean", "intensity_std"):
        values = np.asarray([item[key] for item in stats_list], dtype=np.float32)
        thresholds[key] = (
            float(np.quantile(values, 0.05)),
            float(np.quantile(values, 0.10)),
        )
    return thresholds


def _score_feature_penalty(
    visual_stats: dict[str, float],
    *,
    thresholds: dict[str, tuple[float, float]],
) -> float:
    penalty = 0.0
    for key, value in visual_stats.items():
        p05, p10 = thresholds.get(key, (0.0, 0.0))
        if value < p05:
            penalty += 0.07
        elif value < p10:
            penalty += 0.03
    return penalty


def _build_index(reference_dir: Path, cache_path: Path, *, limit: int) -> ReferenceIndex:
    paths = _iter_reference_paths(reference_dir, limit=limit)
    if not paths:
        raise RuntimeError(f"诈骗图片目录为空: {_display_path(reference_dir)}")

    fingerprint = _build_fingerprint(paths)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.is_file():
        try:
            cached = torch.load(cache_path, map_location="cpu", weights_only=False)
            if (
                isinstance(cached, dict)
                and cached.get("version") == _INDEX_VERSION
                and cached.get("fingerprint") == fingerprint
            ):
                features = cached["features"].float().cpu()
                centroid = cached["centroid"].float().cpu()
                return ReferenceIndex(
                    reference_dir=_display_path(reference_dir),
                    fingerprint=fingerprint,
                    features=features,
                    centroid=centroid,
                    file_paths=list(cached["file_paths"]),
                    file_labels=list(cached["file_labels"]),
                    positive_threshold=float(cached["positive_threshold"]),
                    review_threshold=float(cached["review_threshold"]),
                    positive_score_p10=float(cached.get("positive_score_p10", cached["positive_threshold"])),
                    positive_score_mean=float(cached.get("positive_score_mean", cached["positive_threshold"])),
                    stat_thresholds={
                        str(key): (float(value[0]), float(value[1]))
                        for key, value in dict(cached.get("stat_thresholds") or {}).items()
                        if isinstance(value, (list, tuple)) and len(value) >= 2
                    },
                )
        except Exception:  # noqa: BLE001
            logger.exception("加载诈骗图片索引缓存失败，将重建索引: %s", cache_path)

    logger.info("正在构建诈骗图片索引: dir=%s count=%s", reference_dir, len(paths))
    file_paths: list[str] = []
    file_labels: list[str] = []
    feature_batches: list[torch.Tensor] = []
    stats_list: list[dict[str, float]] = []
    image_batch: list[Image.Image] = []

    def flush_batch() -> None:
        nonlocal image_batch
        if not image_batch:
            return
        feature_batches.append(_extract_features(image_batch))
        image_batch = []

    for path in paths:
        try:
            image = _load_pil_from_path(path)
            image_batch.append(image)
            file_paths.append(_display_path(path))
            file_labels.append(_image_label(path))
            stats_list.append(_compute_visual_stats(image))
        except Exception:  # noqa: BLE001
            logger.exception("读取诈骗图片样本失败，已跳过: %s", path)
            continue
        if len(image_batch) >= _EMBEDDING_BATCH_SIZE:
            flush_batch()
    flush_batch()

    if not feature_batches:
        raise RuntimeError(f"诈骗图片样本无法读取: {_display_path(reference_dir)}")

    features = torch.cat(feature_batches, dim=0)
    centroid = F.normalize(features.mean(dim=0, keepdim=True), dim=1).squeeze(0)
    positive_threshold, review_threshold, positive_score_p10, positive_score_mean = _score_reference_distribution(features)
    stat_thresholds = _build_stat_thresholds(stats_list)

    payload = {
        "version": _INDEX_VERSION,
        "fingerprint": fingerprint,
        "features": features,
        "centroid": centroid,
        "file_paths": file_paths,
        "file_labels": file_labels,
        "positive_threshold": positive_threshold,
        "review_threshold": review_threshold,
        "positive_score_p10": positive_score_p10,
        "positive_score_mean": positive_score_mean,
        "stat_thresholds": stat_thresholds,
    }
    torch.save(payload, cache_path)

    return ReferenceIndex(
        reference_dir=_display_path(reference_dir),
        fingerprint=fingerprint,
        features=features,
        centroid=centroid,
        file_paths=file_paths,
        file_labels=file_labels,
        positive_threshold=positive_threshold,
        review_threshold=review_threshold,
        positive_score_p10=positive_score_p10,
        positive_score_mean=positive_score_mean,
        stat_thresholds=stat_thresholds,
    )


def get_reference_index() -> ReferenceIndex:
    global _REFERENCE_INDEX, _REFERENCE_INDEX_KEY

    reference_dir = _resolve_path(settings.image_fraud_reference_dir)
    cache_path = _resolve_path(settings.image_fraud_cache_path)
    key = (str(reference_dir), str(cache_path), int(settings.image_fraud_reference_limit))

    with _INDEX_LOCK:
        if _REFERENCE_INDEX is not None and _REFERENCE_INDEX_KEY == key:
            return _REFERENCE_INDEX

        _REFERENCE_INDEX = _build_index(
            reference_dir,
            cache_path,
            limit=int(settings.image_fraud_reference_limit),
        )
        _REFERENCE_INDEX_KEY = key
        return _REFERENCE_INDEX


def _score_query(
    query_feature: torch.Tensor,
    *,
    features: torch.Tensor,
    centroid: torch.Tensor,
) -> tuple[float, float, float, torch.Tensor]:
    similarities = features @ query_feature
    top_k = min(max(1, int(settings.image_fraud_top_k or _DEFAULT_TOP_K)), similarities.shape[0])
    top_values, _ = similarities.topk(k=top_k)
    max_similarity = float(top_values[0].item())
    mean_top_similarity = float(top_values.mean().item())
    centroid_similarity = float(torch.dot(query_feature, centroid).item())
    score = 0.55 * max_similarity + 0.25 * mean_top_similarity + 0.20 * centroid_similarity
    return score, max_similarity, mean_top_similarity, similarities


def _build_matches(index: ReferenceIndex, similarities: torch.Tensor) -> list[ReferenceMatch]:
    top_k = min(max(1, int(settings.image_fraud_top_k or _DEFAULT_TOP_K)), similarities.shape[0])
    top_values, top_indices = similarities.topk(k=top_k)
    items: list[ReferenceMatch] = []
    for rank, (score, idx) in enumerate(zip(top_values.tolist(), top_indices.tolist(), strict=False), start=1):
        items.append(
            ReferenceMatch(
                rank=rank,
                path=index.file_paths[idx],
                label=index.file_labels[idx],
                similarity=float(score),
            )
        )
    return items


def _risk_from_score(
    score: float,
    *,
    max_similarity: float,
    positive_threshold: float,
    review_threshold: float,
) -> tuple[str, bool, bool]:
    if score >= positive_threshold and max_similarity >= 0.94:
        return "high", True, False
    if score >= review_threshold:
        return "medium", False, True
    return "low", False, False


def check_image_fraud(
    *,
    image_bytes: bytes,
    filename: str | None = None,
) -> ImageFraudCheckResult:
    if not image_bytes:
        raise ValueError("图片内容不能为空")

    image = _load_pil_from_bytes(image_bytes)
    query_feature = _extract_features([image])
    if query_feature.numel() == 0:
        raise ValueError("图片解析失败")

    index = get_reference_index()
    query = query_feature[0]
    base_score, max_similarity, mean_top_similarity, similarities = _score_query(
        query,
        features=index.features,
        centroid=index.centroid,
    )
    visual_stats = _compute_visual_stats(image)
    feature_penalty = _score_feature_penalty(
        visual_stats,
        thresholds=index.stat_thresholds,
    )
    score = max(0.0, base_score - feature_penalty)
    matches = _build_matches(index, similarities)
    risk_level, is_fraud, need_manual_review = _risk_from_score(
        score,
        max_similarity=max_similarity,
        positive_threshold=index.positive_threshold,
        review_threshold=index.review_threshold,
    )

    if score >= index.positive_threshold:
        confidence = min(0.99, max(score, 0.68))
    elif score >= index.review_threshold:
        confidence = min(0.9, max(score, 0.52))
    else:
        confidence = min(0.49, max(score * 0.72, 0.08))

    centroid_similarity = float(torch.dot(query, index.centroid).item())
    return ImageFraudCheckResult(
        filename=(filename or "image").strip() or "image",
        score=float(score),
        confidence=float(confidence),
        risk_level=risk_level,
        is_fraud=is_fraud,
        need_manual_review=need_manual_review,
        max_similarity=float(max_similarity),
        mean_top_similarity=float(mean_top_similarity),
        centroid_similarity=centroid_similarity,
        base_score=float(base_score),
        feature_penalty=float(feature_penalty),
        review_threshold=index.review_threshold,
        positive_threshold=index.positive_threshold,
        reference_count=len(index.file_paths),
        model_name="resnet18-imagebank",
        matches=matches,
        visual_stats=visual_stats,
    )
