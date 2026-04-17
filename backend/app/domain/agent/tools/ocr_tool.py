from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domain.agent.providers.baidu_ocr import recognize_baidu_accurate
from app.shared.core.config import settings


def extract_texts(*, image_paths: list[str], fallback_text: str | None) -> dict[str, Any]:
    provider = settings.ocr_provider.strip().lower()
    observations: list[dict[str, Any]] = []
    aggregated: list[str] = []

    if fallback_text and fallback_text.strip():
        aggregated.append(fallback_text.strip())
        observations.append(
            {
                "source": "text_content",
                "text": fallback_text.strip(),
                "provider": "submission",
            }
        )

    if provider == "baidu":
        raw_results: list[dict[str, Any]] = []
        warnings: list[str] = []
        for path in image_paths:
            file_path = Path(path)
            if not file_path.exists():
                message = f"Image file does not exist: {path}"
                warnings.append(message)
                observations.append(
                    {
                        "source": path,
                        "text": "",
                        "provider": "baidu",
                        "warning": message,
                    }
                )
                continue

            try:
                payload = recognize_baidu_accurate(file_path.read_bytes(), filename=file_path.name)
                text = str(payload.get("text") or "").strip()
                if text:
                    aggregated.append(text)
                observations.append(
                    {
                        "source": str(file_path),
                        "text": text,
                        "provider": "baidu",
                        "log_id": payload.get("log_id"),
                        "direction": payload.get("direction"),
                        "words_result_num": payload.get("words_result_num"),
                        "words_result": payload.get("words_result"),
                        "paragraphs_result_num": payload.get("paragraphs_result_num"),
                        "paragraphs_result": payload.get("paragraphs_result"),
                    }
                )
                raw_results.append(
                    {
                        "source_path": str(file_path),
                        "status": "completed",
                        "raw": payload.get("raw"),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                message = f"Baidu OCR failed for {path}: {type(exc).__name__}: {exc}"
                warnings.append(message)
                observations.append(
                    {
                        "source": str(file_path),
                        "text": "",
                        "provider": "baidu",
                        "warning": message,
                    }
                )

        return {
            "provider": "baidu",
            "aggregated_text": "\n".join(part for part in aggregated if part).strip(),
            "observations": observations,
            "warnings": warnings,
            "raw_results": raw_results,
        }

    if provider != "stub":
        observations.append(
            {
                "source": "ocr",
                "text": "",
                "provider": provider,
                "warning": "OCR provider is configured in settings but not implemented in this first version.",
            }
        )
        return {
            "provider": provider,
            "aggregated_text": "\n".join(aggregated).strip(),
            "observations": observations,
            "warnings": ["OCR provider integration is pending."],
        }

    for path in image_paths:
        filename_hint = Path(path).stem.replace("_", " ").replace("-", " ").strip()
        observations.append(
            {
                "source": path,
                "text": filename_hint,
                "provider": "stub",
                "warning": "Stub OCR only uses the filename as a text hint.",
            }
        )
        if filename_hint:
            aggregated.append(filename_hint)

    return {
        "provider": "stub",
        "aggregated_text": "\n".join(part for part in aggregated if part).strip(),
        "observations": observations,
        "warnings": ["Stub OCR is active; replace it with a real OCR provider later."],
    }
