from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import numpy as np
from PIL import Image, UnidentifiedImageError

from app.shared.core.config import settings

try:
    import cv2
except Exception:  # noqa: BLE001
    cv2 = None


_HASH_SIZE = 8
_PHASH_IMAGE_SIZE = 32


@dataclass(slots=True)
class _ClipRuntime:
    model: Any
    processor: Any
    torch: Any
    device: str
    model_name: str

    def encode(self, image: Image.Image) -> np.ndarray:
        inputs = self.processor(images=image, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(self.device)
        with self.torch.no_grad():
            features = self.model.get_image_features(pixel_values=pixel_values)
        features = features / features.norm(dim=-1, keepdim=True)
        return features[0].detach().cpu().numpy().astype(np.float32)


def _hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _hash_similarity(distance: int, bits: int = 64) -> float:
    return round(max(0.0, 1.0 - (distance / bits)), 4)


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 0:
        return 0.0
    return round(float(np.dot(left, right) / denominator), 4)


def _clip_enabled() -> bool:
    return settings.image_similarity_clip_enabled


def _select_device(torch_module: Any) -> str:
    configured = settings.image_similarity_clip_device.strip().lower()
    if configured and configured != "auto":
        return configured
    return "cuda" if bool(torch_module.cuda.is_available()) else "cpu"


_CLIP_RUNTIME: _ClipRuntime | None = None
_CLIP_RUNTIME_ERROR: str | None = None


def _get_clip_runtime() -> _ClipRuntime:
    global _CLIP_RUNTIME, _CLIP_RUNTIME_ERROR
    if _CLIP_RUNTIME is not None:
        return _CLIP_RUNTIME
    if _CLIP_RUNTIME_ERROR is not None:
        raise RuntimeError(_CLIP_RUNTIME_ERROR)

    try:
        import torch
        from transformers import CLIPImageProcessor, CLIPModel
    except Exception as exc:  # noqa: BLE001
        _CLIP_RUNTIME_ERROR = (
            "CLIP dependencies are unavailable. Install torch and transformers to enable "
            f"embedding similarity. Original error: {type(exc).__name__}: {exc}"
        )
        raise RuntimeError(_CLIP_RUNTIME_ERROR) from exc

    model_name = settings.image_similarity_clip_model.strip() or "openai/clip-vit-large-patch14"
    device = _select_device(torch)
    try:
        model = CLIPModel.from_pretrained(model_name)
        processor = CLIPImageProcessor.from_pretrained(model_name)
    except Exception as exc:  # noqa: BLE001
        _CLIP_RUNTIME_ERROR = (
            f"Unable to load CLIP model '{model_name}'. Original error: {type(exc).__name__}: {exc}"
        )
        raise RuntimeError(_CLIP_RUNTIME_ERROR) from exc

    model = model.to(device)
    model.eval()
    _CLIP_RUNTIME = _ClipRuntime(
        model=model,
        processor=processor,
        torch=torch,
        device=device,
        model_name=model_name,
    )
    return _CLIP_RUNTIME


def _open_local_image(path: str) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGB")


def _open_image_bytes(data: bytes) -> Image.Image:
    with Image.open(BytesIO(data)) as image:
        return image.convert("RGB")


def _compute_dhash(image: Image.Image, hash_size: int = _HASH_SIZE) -> int:
    grayscale = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = np.asarray(grayscale, dtype=np.int16)
    diff = pixels[:, 1:] > pixels[:, :-1]
    value = 0
    for bit in diff.flatten():
        value = (value << 1) | int(bool(bit))
    return int(value)


def _compute_phash(image: Image.Image, hash_size: int = _HASH_SIZE, image_size: int = _PHASH_IMAGE_SIZE) -> int:
    if cv2 is None:
        raise RuntimeError("OpenCV is required for perceptual hash computation but is unavailable.")

    grayscale = image.convert("L").resize((image_size, image_size), Image.Resampling.LANCZOS)
    pixels = np.asarray(grayscale, dtype=np.float32)
    dct = cv2.dct(pixels)
    low_freq = dct[:hash_size, :hash_size]
    median = float(np.median(low_freq[1:, 1:]))
    bits = low_freq > median
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bool(bit))
    return int(value)


def _looks_like_http_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def _extract_nested_image_urls(url: str) -> list[str]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=False)
    nested: list[str] = []
    for key in ("image", "imgurl", "objurl", "origin", "src", "url"):
        for value in query.get(key, []):
            decoded = unquote(str(value or "")).strip()
            if _looks_like_http_url(decoded):
                nested.append(decoded)
    return nested


def _candidate_urls(item: dict[str, Any]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for key in ("image_url", "thumbnail_url"):
        raw_value = str(item.get(key) or "").strip()
        if not _looks_like_http_url(raw_value):
            continue
        for candidate in [*_extract_nested_image_urls(raw_value), raw_value]:
            normalized = str(candidate or "").strip()
            if not _looks_like_http_url(normalized) or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
    return ordered


def _download_candidate_image(url: str) -> bytes:
    timeout = max(3.0, float(settings.image_similarity_download_timeout_seconds))
    max_bytes = max(256 * 1024, int(settings.image_similarity_download_max_bytes))
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/135.0.0.0 Safari/537.36"
        )
    }

    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "").lower()
        if content_type and "image" not in content_type:
            raise RuntimeError(f"Candidate URL does not look like an image: {content_type}")
        data = response.content
        if len(data) > max_bytes:
            raise RuntimeError(f"Candidate image is too large: {len(data)} bytes")
        return data


def _inspect_source_image(source_path: str, *, use_clip: bool) -> dict[str, Any]:
    path = Path(source_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file does not exist: {source_path}")

    image = _open_local_image(source_path)
    try:
        width, height = image.size
        return {
            "path": source_path,
            "size": {"width": width, "height": height},
            "phash": _compute_phash(image),
            "dhash": _compute_dhash(image),
            "clip_embedding": _encode_clip_image(image) if use_clip else None,
        }
    finally:
        image.close()


def _encode_clip_image(image: Image.Image) -> np.ndarray | None:
    runtime = _get_clip_runtime()
    return runtime.encode(image)


def _score_candidate(
    *,
    source: dict[str, Any],
    item: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    candidate_urls = _candidate_urls(item)
    if not candidate_urls:
        return None, "Candidate image URL is missing."

    raw = None
    image = None
    selected_url = None
    download_errors: list[str] = []
    for url in candidate_urls:
        try:
            raw = _download_candidate_image(url)
            image = _open_image_bytes(raw)
            selected_url = url
            break
        except (httpx.HTTPError, RuntimeError, UnidentifiedImageError, OSError) as exc:
            download_errors.append(f"{url} -> {type(exc).__name__}: {exc}")

    if raw is None or image is None or selected_url is None:
        return None, "Unable to load candidate image from any candidate URL: " + "; ".join(download_errors[:3])

    try:
        phash = _compute_phash(image)
        dhash = _compute_dhash(image)
        phash_distance = _hamming_distance(int(source["phash"]), phash)
        dhash_distance = _hamming_distance(int(source["dhash"]), dhash)
        phash_similarity = _hash_similarity(phash_distance)
        dhash_similarity = _hash_similarity(dhash_distance)
        hash_similarity = round(max(phash_similarity, dhash_similarity), 4)
        clip_similarity = None
        if source.get("clip_embedding") is not None and _clip_enabled():
            clip_embedding = _encode_clip_image(image)
            if clip_embedding is not None:
                clip_similarity = _cosine_similarity(source["clip_embedding"], clip_embedding)

        phash_threshold = max(0, int(settings.image_similarity_phash_distance_threshold))
        dhash_threshold = max(0, int(settings.image_similarity_dhash_distance_threshold))
        clip_high = float(settings.image_similarity_clip_high_threshold)
        clip_medium = float(settings.image_similarity_clip_medium_threshold)

        hash_near = phash_distance <= phash_threshold or dhash_distance <= dhash_threshold
        clip_high_match = clip_similarity is not None and clip_similarity >= clip_high
        clip_medium_match = clip_similarity is not None and clip_similarity >= clip_medium
        kept = bool(hash_near or clip_high_match or (clip_medium_match and hash_similarity >= 0.6))

        return {
            **item,
            "candidate_url": selected_url,
            "candidate_url_attempts": candidate_urls,
            "phash_distance": phash_distance,
            "dhash_distance": dhash_distance,
            "phash_similarity": phash_similarity,
            "dhash_similarity": dhash_similarity,
            "hash_similarity": hash_similarity,
            "clip_similarity": clip_similarity,
            "hash_near_duplicate": hash_near,
            "clip_high_similarity": clip_high_match,
            "clip_medium_similarity": clip_medium_match,
            "kept": kept,
        }, None
    finally:
        image.close()


def validate_reverse_image_matches(
    *,
    image_paths: list[str],
    matches: list[dict[str, Any]],
) -> dict[str, Any]:
    warnings: list[str] = []
    grouped_matches: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in matches:
        source_path = str(item.get("source_path") or "").strip()
        if source_path:
            grouped_matches[source_path].append(item)

    per_source: list[dict[str, Any]] = []
    validated_matches: list[dict[str, Any]] = []
    discarded_matches: list[dict[str, Any]] = []
    clip_runtime = None

    if _clip_enabled():
        try:
            clip_runtime = _get_clip_runtime()
        except RuntimeError as exc:
            warnings.append(str(exc))

    for source_path in image_paths:
        source_warnings: list[str] = []
        try:
            source = _inspect_source_image(source_path, use_clip=clip_runtime is not None)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Unable to inspect source image {source_path}: {type(exc).__name__}: {exc}")
            continue

        candidates = grouped_matches.get(source_path, [])[: max(1, int(settings.image_similarity_candidate_limit))]
        source_validated: list[dict[str, Any]] = []
        source_discarded: list[dict[str, Any]] = []

        for item in candidates:
            scored, error = _score_candidate(source=source, item=item)
            if error:
                source_warnings.append(error)
                continue
            if scored is None:
                continue
            if scored["kept"]:
                source_validated.append(scored)
                validated_matches.append(scored)
            else:
                source_discarded.append(scored)
                discarded_matches.append(scored)

        per_source.append(
            {
                "source_path": source_path,
                "source_size": source.get("size"),
                "validated_matches": source_validated,
                "discarded_matches": source_discarded[:3],
                "warnings": source_warnings,
            }
        )
        warnings.extend(source_warnings)

    scored_matches = [*validated_matches, *discarded_matches]
    unique_domains = sorted({str(item.get("domain") or "").strip() for item in validated_matches if str(item.get("domain") or "").strip()})
    cross_site_high_similarity_count = len(unique_domains)
    hash_near_duplicate_count = sum(1 for item in validated_matches if item.get("hash_near_duplicate"))
    clip_high_similarity_count = sum(1 for item in validated_matches if item.get("clip_high_similarity"))
    max_clip_similarity = max(
        (float(item.get("clip_similarity")) for item in scored_matches if item.get("clip_similarity") is not None),
        default=None,
    )
    max_hash_similarity = max((float(item.get("hash_similarity") or 0.0) for item in scored_matches), default=0.0)
    strongest_match = None
    if scored_matches:
        strongest_match_item = max(
            scored_matches,
            key=lambda item: (
                float(item.get("clip_similarity") or 0.0),
                float(item.get("hash_similarity") or 0.0),
                1 if item.get("kept") else 0,
            ),
        )
        strongest_match = {
            "domain": strongest_match_item.get("domain"),
            "source_url": strongest_match_item.get("source_url"),
            "candidate_url": strongest_match_item.get("candidate_url"),
            "clip_similarity": strongest_match_item.get("clip_similarity"),
            "hash_similarity": strongest_match_item.get("hash_similarity"),
            "kept": bool(strongest_match_item.get("kept")),
        }

    return {
        "clip_enabled": _clip_enabled(),
        "clip_model": clip_runtime.model_name if clip_runtime is not None else None,
        "per_source": per_source,
        "validated_matches": validated_matches,
        "discarded_matches": discarded_matches[:5],
        "warnings": warnings,
        "summary": {
            "scored_match_count": len(scored_matches),
            "validated_match_count": len(validated_matches),
            "cross_site_high_similarity_count": cross_site_high_similarity_count,
            "hash_near_duplicate_count": hash_near_duplicate_count,
            "clip_high_similarity_count": clip_high_similarity_count,
            "max_clip_similarity": round(max_clip_similarity, 4) if max_clip_similarity is not None else None,
            "max_hash_similarity": round(max_hash_similarity, 4),
            "unique_domains": unique_domains,
            "strongest_match": strongest_match,
        },
    }
