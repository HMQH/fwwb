from __future__ import annotations

from typing import Any


def _candidate_images(cv2: Any, image: Any) -> list[Any]:
    variants: list[Any] = [image]
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        variants.append(gray)
        variants.append(cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC))
        variants.append(cv2.GaussianBlur(gray, (3, 3), 0))
        variants.append(
            cv2.adaptiveThreshold(
                gray,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                31,
                5,
            )
        )
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(otsu)
    except Exception:
        pass
    return variants


def _decode_single(detector: Any, candidate: Any) -> list[tuple[str, bool]]:
    results: list[tuple[str, bool]] = []
    try:
        decoded, points, _straight = detector.detectAndDecode(candidate)
        if decoded:
            results.append((str(decoded).strip(), points is not None))
    except Exception:
        pass

    try:
        ok, decoded_infos, points, _straight = detector.detectAndDecodeMulti(candidate)
        if ok and decoded_infos:
            has_points = points is not None
            for item in decoded_infos:
                decoded = str(item or "").strip()
                if decoded:
                    results.append((decoded, has_points))
    except Exception:
        pass

    return results


def decode_qr_codes(image_paths: list[str]) -> dict[str, Any]:
    matches: list[dict[str, Any]] = []
    warnings: list[str] = []

    try:
        import cv2
    except Exception as exc:  # noqa: BLE001
        return {"matches": matches, "warnings": [f"OpenCV is unavailable: {exc}"]}

    detector = cv2.QRCodeDetector()
    for path in image_paths:
        image = cv2.imread(path)
        if image is None:
            warnings.append(f"Unable to read image: {path}")
            continue

        seen_payloads: set[str] = set()
        for candidate in _candidate_images(cv2, image):
            for decoded, has_points in _decode_single(detector, candidate):
                if decoded in seen_payloads:
                    continue
                seen_payloads.add(decoded)
                matches.append(
                    {
                        "source_path": path,
                        "payload": decoded,
                        "has_points": has_points,
                    }
                )

    return {"matches": matches, "warnings": warnings}
