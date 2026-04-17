from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domain.agent.providers.baidu_reverse_image import search_baidu_reverse_image
from app.shared.core.config import settings


def reverse_image_search(image_paths: list[str]) -> dict[str, Any]:
    provider = settings.reverse_image_provider.strip().lower()
    warnings: list[str] = []
    all_matches: list[dict[str, Any]] = []
    raw_results: list[dict[str, Any]] = []

    if provider != "baidu":
        return {
            "provider": provider,
            "status": "not_configured",
            "matches": [],
            "warnings": [f"Reverse image provider '{provider}' is not implemented yet."],
            "raw": [],
        }

    for path in image_paths:
        file_path = Path(path)
        if not file_path.exists():
            warnings.append(f"Image file does not exist: {path}")
            continue

        try:
            result = search_baidu_reverse_image(file_path.read_bytes(), filename=file_path.name)
            for item in result.matches:
                item["source_path"] = str(file_path)
            all_matches.extend(result.matches)
            warnings.extend(result.warnings)
            raw_results.append(
                {
                    "source_path": str(file_path),
                    "status": result.status,
                    "raw": result.raw,
                }
            )
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"Baidu reverse image search failed for {path}: {type(exc).__name__}: {exc}"
            )

    status = "completed" if all_matches else "partial" if warnings else "completed"
    return {
        "provider": provider,
        "status": status,
        "matches": all_matches,
        "warnings": warnings,
        "raw": raw_results,
    }
