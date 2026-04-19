from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.shared.core.config import settings

_MEDIAPIPE = None
_SCIPY_SIGNAL = None

MODEL_LABEL = "MediaPipe Tasks FaceLandmarker + CHROM (MVP)"

_HEAD_POSE_LANDMARKS = {
    "nose": 1,
    "chin": 152,
    "left_eye": 33,
    "right_eye": 263,
    "left_mouth": 61,
    "right_mouth": 291,
}

_FACE_MODEL_POINTS = np.asarray(
    [
        (0.0, 0.0, 0.0),
        (0.0, -63.6, -12.5),
        (-43.3, 32.7, -26.0),
        (43.3, 32.7, -26.0),
        (-28.9, -28.9, -24.1),
        (28.9, -28.9, -24.1),
    ],
    dtype=np.float64,
)

_LEFT_IRIS_INDEXES = (468, 469, 470, 471, 472)
_RIGHT_IRIS_INDEXES = (473, 474, 475, 476, 477)
_GAZE_ABS_LIMIT = 1.5
_HEAD_MOTION_PITCH_LIMIT = 45.0
_HEAD_MOTION_YAW_LIMIT = 45.0
_HEAD_MOTION_ROLL_LIMIT = 35.0
_FACE_PRECHECK_TARGET_FPS = 3.0
_FACE_PRECHECK_MAX_DURATION_SECONDS = 12.0
_FACE_PRECHECK_MIN_FACE_FRAMES = 6
_FACE_PRECHECK_MIN_FACE_RATIO = 0.35


@dataclass
class _HrTrack:
    times: list[float]
    bpm: list[float]
    quality: list[float]


def _risk_rank(level: str | None) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(str(level or "").lower(), 0)


def _mediapipe_module():
    global _MEDIAPIPE
    if _MEDIAPIPE is None:
        import mediapipe as mp  # type: ignore

        _MEDIAPIPE = mp
    return _MEDIAPIPE


def _face_landmarker_model_path() -> Path:
    model_path = Path(settings.video_deception_face_landmarker_path).expanduser().resolve()
    if not model_path.exists():
        raise RuntimeError(
            "MediaPipe Face Landmarker model not found: "
            f"{model_path}. Put a .task model at this path or set "
            "VIDEO_DECEPTION_FACE_LANDMARKER_PATH in backend/.env."
        )
    return model_path


def _create_face_landmarker(*, output_face_blendshapes: bool = True):
    mp = _mediapipe_module()
    model_path = _face_landmarker_model_path()
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=output_face_blendshapes,
        output_facial_transformation_matrixes=False,
    )
    return mp.tasks.vision.FaceLandmarker.create_from_options(options)


def _signal_module():
    global _SCIPY_SIGNAL
    if _SCIPY_SIGNAL is None:
        from scipy import signal as scipy_signal  # type: ignore

        _SCIPY_SIGNAL = scipy_signal
    return _SCIPY_SIGNAL


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return float(fallback)
    return parsed if np.isfinite(parsed) else float(fallback)


def _has_landmark(landmarks: list[Any], index: int) -> bool:
    return 0 <= index < len(landmarks)


def _mean_point(points: list[tuple[float, float]]) -> tuple[float, float]:
    if not points:
        return 0.0, 0.0
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return float(np.mean(xs)), float(np.mean(ys))


def _landmark_xy(landmarks: list[Any], index: int, width: int, height: int) -> tuple[float, float]:
    point = landmarks[index]
    return float(point.x * width), float(point.y * height)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def _normalize_angle_degrees(value: float) -> float:
    normalized = (float(value) + 180.0) % 360.0 - 180.0
    if normalized == -180.0:
        return 180.0
    return normalized


def _median_filter(values: list[float], kernel_size: int = 5) -> list[float]:
    if len(values) < 3:
        return [float(value) for value in values]
    kernel_size = max(3, int(kernel_size) | 1)
    radius = kernel_size // 2
    padded = np.pad(np.asarray(values, dtype=np.float64), (radius, radius), mode="edge")
    filtered: list[float] = []
    for index in range(len(values)):
        window = padded[index:index + kernel_size]
        filtered.append(float(np.median(window)))
    return filtered


def _moving_average(values: list[float], window_size: int = 3) -> list[float]:
    if len(values) < 3:
        return [float(value) for value in values]
    window_size = max(1, int(window_size))
    radius = window_size // 2
    padded = np.pad(np.asarray(values, dtype=np.float64), (radius, radius), mode="edge")
    smoothed: list[float] = []
    for index in range(len(values)):
        window = padded[index:index + window_size]
        smoothed.append(float(np.mean(window)))
    return smoothed


def _smooth_series(values: list[float], *, clip_low: float | None = None, clip_high: float | None = None) -> list[float]:
    if not values:
        return []
    sanitized = [_safe_float(value) for value in values]
    if clip_low is not None and clip_high is not None:
        sanitized = [_clip(value, clip_low, clip_high) for value in sanitized]
    smoothed = _median_filter(sanitized, kernel_size=5)
    smoothed = _moving_average(smoothed, window_size=3)
    if clip_low is not None and clip_high is not None:
        smoothed = [_clip(value, clip_low, clip_high) for value in smoothed]
    return smoothed


def _relative_angle_series(values: list[float]) -> list[float]:
    if not values:
        return []
    baseline = _safe_float(values[0])
    relative: list[float] = []
    for value in values:
        current = _safe_float(value)
        relative.append(_normalize_angle_degrees(current - baseline))
    return relative


def _smooth_rgb_series(rgb_series: np.ndarray) -> np.ndarray:
    if len(rgb_series) < 3:
        return rgb_series
    smoothed = rgb_series.astype(np.float64, copy=True)
    for channel in range(smoothed.shape[1]):
        smoothed[:, channel] = np.asarray(
            _moving_average(smoothed[:, channel].tolist(), window_size=3),
            dtype=np.float64,
        )
    return smoothed


def _series_payload(times: list[float], values: list[float], *, max_points: int = 120) -> dict[str, list[float]]:
    if not times or not values:
        return {"times": [], "values": []}
    if len(times) != len(values):
        usable = min(len(times), len(values))
        times = times[:usable]
        values = values[:usable]
    if len(times) > max_points:
        indices = np.linspace(0, len(times) - 1, max_points).astype(int)
        times = [times[index] for index in indices]
        values = [values[index] for index in indices]
    return {
        "times": [round(float(value), 3) for value in times],
        "values": [round(float(value), 4) for value in values],
    }


def _normalize_series_std(values: list[float], *, low: float, high: float) -> float:
    if len(values) < 2:
        return 0.0
    score = (float(np.std(values)) - low) / max(high - low, 1e-6)
    return _clip01(score)


def _head_pose_angles(landmarks: list[Any], width: int, height: int) -> tuple[float, float, float] | None:
    required = tuple(_HEAD_POSE_LANDMARKS.values())
    if not all(_has_landmark(landmarks, index) for index in required):
        return None
    image_points = np.asarray(
        [
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["nose"], width, height),
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["chin"], width, height),
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["left_eye"], width, height),
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["right_eye"], width, height),
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["left_mouth"], width, height),
            _landmark_xy(landmarks, _HEAD_POSE_LANDMARKS["right_mouth"], width, height),
        ],
        dtype=np.float64,
    )
    focal_length = float(width)
    camera_matrix = np.asarray(
        [
            [focal_length, 0, width / 2.0],
            [0, focal_length, height / 2.0],
            [0, 0, 1.0],
        ],
        dtype=np.float64,
    )
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)
    success, rotation_vector, _ = cv2.solvePnP(
        _FACE_MODEL_POINTS,
        image_points,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not success:
        return None
    rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
    sy = float(np.sqrt(rotation_matrix[0, 0] ** 2 + rotation_matrix[1, 0] ** 2))
    singular = sy < 1e-6
    if not singular:
        pitch = float(np.degrees(np.arctan2(rotation_matrix[2, 1], rotation_matrix[2, 2])))
        yaw = float(np.degrees(np.arctan2(-rotation_matrix[2, 0], sy)))
        roll = float(np.degrees(np.arctan2(rotation_matrix[1, 0], rotation_matrix[0, 0])))
    else:
        pitch = float(np.degrees(np.arctan2(-rotation_matrix[1, 2], rotation_matrix[1, 1])))
        yaw = float(np.degrees(np.arctan2(-rotation_matrix[2, 0], sy)))
        roll = 0.0
    return (
        _normalize_angle_degrees(pitch),
        _normalize_angle_degrees(yaw),
        _normalize_angle_degrees(roll),
    )


def _iris_center_or_eye_center(
    landmarks: list[Any],
    iris_indexes: tuple[int, ...],
    fallback_indexes: tuple[int, ...],
    width: int,
    height: int,
) -> tuple[float, float]:
    iris_points = [
        _landmark_xy(landmarks, index, width, height)
        for index in iris_indexes
        if _has_landmark(landmarks, index)
    ]
    if iris_points:
        return _mean_point(iris_points)
    fallback_points = [
        _landmark_xy(landmarks, index, width, height)
        for index in fallback_indexes
        if _has_landmark(landmarks, index)
    ]
    return _mean_point(fallback_points)


def _extract_behavior_features(landmarks: list[Any], width: int, height: int) -> dict[str, float] | None:
    required_indexes = [33, 133, 145, 159, 263, 362, 374, 386, 61, 291, 13, 14, 0, 17, 105, 334]
    if not all(_has_landmark(landmarks, index) for index in required_indexes):
        return None

    left_inner = _landmark_xy(landmarks, 133, width, height)
    left_outer = _landmark_xy(landmarks, 33, width, height)
    right_inner = _landmark_xy(landmarks, 362, width, height)
    right_outer = _landmark_xy(landmarks, 263, width, height)
    left_upper = _landmark_xy(landmarks, 159, width, height)
    left_lower = _landmark_xy(landmarks, 145, width, height)
    right_upper = _landmark_xy(landmarks, 386, width, height)
    right_lower = _landmark_xy(landmarks, 374, width, height)

    left_iris = _iris_center_or_eye_center(landmarks, _LEFT_IRIS_INDEXES, (33, 133), width, height)
    right_iris = _iris_center_or_eye_center(landmarks, _RIGHT_IRIS_INDEXES, (263, 362), width, height)

    left_eye_width = max(_distance(left_outer, left_inner), 1e-6)
    right_eye_width = max(_distance(right_outer, right_inner), 1e-6)
    left_eye_height = _distance(left_upper, left_lower)
    right_eye_height = _distance(right_upper, right_lower)

    left_gaze_x = ((left_iris[0] - left_outer[0]) / left_eye_width) * 2.0 - 1.0
    right_gaze_x = ((right_iris[0] - right_outer[0]) / right_eye_width) * 2.0 - 1.0
    left_gaze_y = ((left_iris[1] - left_upper[1]) / max(left_lower[1] - left_upper[1], 1e-6)) * 2.0 - 1.0
    right_gaze_y = ((right_iris[1] - right_upper[1]) / max(right_lower[1] - right_upper[1], 1e-6)) * 2.0 - 1.0

    brow_left = _landmark_xy(landmarks, 105, width, height)
    brow_right = _landmark_xy(landmarks, 334, width, height)
    mouth_left = _landmark_xy(landmarks, 61, width, height)
    mouth_right = _landmark_xy(landmarks, 291, width, height)
    mouth_upper = _landmark_xy(landmarks, 13, width, height)
    mouth_lower = _landmark_xy(landmarks, 14, width, height)
    lip_upper_inner = _landmark_xy(landmarks, 0, width, height)
    lip_lower_inner = _landmark_xy(landmarks, 17, width, height)

    mouth_width = max(_distance(mouth_left, mouth_right), 1e-6)
    brow_distance = (
        _distance(brow_left, left_upper) / max(left_eye_width, 1e-6)
        + _distance(brow_right, right_upper) / max(right_eye_width, 1e-6)
    ) / 2.0
    mouth_open = _distance(mouth_upper, mouth_lower) / mouth_width
    lip_tension = 1.0 - min(_distance(lip_upper_inner, lip_lower_inner) / mouth_width / 0.12, 1.0)
    eye_open = ((left_eye_height / left_eye_width) + (right_eye_height / right_eye_width)) / 2.0

    return {
        "gaze_x": float((left_gaze_x + right_gaze_x) / 2.0),
        "gaze_y": float((left_gaze_y + right_gaze_y) / 2.0),
        "eye_open": float(eye_open),
        "mouth_open": float(mouth_open),
        "brow_raise": float(brow_distance),
        "lip_tension": float(max(0.0, lip_tension)),
    }


def _face_box(landmarks: list[Any], width: int, height: int) -> tuple[int, int, int, int]:
    xs = [landmark.x * width for landmark in landmarks]
    ys = [landmark.y * height for landmark in landmarks]
    x0 = max(int(min(xs)), 0)
    y0 = max(int(min(ys)), 0)
    x1 = min(int(max(xs)), width - 1)
    y1 = min(int(max(ys)), height - 1)
    return x0, y0, x1, y1


def _is_frame_quality_valid(
    behavior: dict[str, float],
    face_box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> bool:
    x0, y0, x1, y1 = face_box
    face_w = max(x1 - x0, 0)
    face_h = max(y1 - y0, 0)
    if not _is_face_box_large_enough(face_box, width, height):
        return False

    gaze_x = _safe_float(behavior.get("gaze_x"))
    gaze_y = _safe_float(behavior.get("gaze_y"))
    eye_open = _safe_float(behavior.get("eye_open"))
    mouth_open = _safe_float(behavior.get("mouth_open"))
    brow_raise = _safe_float(behavior.get("brow_raise"))
    lip_tension = _safe_float(behavior.get("lip_tension"))

    if abs(gaze_x) > 1.8 or abs(gaze_y) > 1.8:
        return False
    if not 0.01 <= eye_open <= 0.65:
        return False
    if not 0.0 <= mouth_open <= 0.85:
        return False
    if not 0.05 <= brow_raise <= 1.8:
        return False
    if not 0.0 <= lip_tension <= 1.0:
        return False
    return True


def _is_face_box_large_enough(
    face_box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> bool:
    x0, y0, x1, y1 = face_box
    face_w = max(x1 - x0, 0)
    face_h = max(y1 - y0, 0)
    return face_w >= max(int(width * 0.08), 48) and face_h >= max(int(height * 0.08), 48)


def _extract_rppg_rgb(frame_rgb: np.ndarray, landmarks: list[Any], width: int, height: int) -> np.ndarray | None:
    x0, y0, x1, y1 = _face_box(landmarks, width, height)
    if x1 <= x0 or y1 <= y0:
        return None
    face_w = x1 - x0
    face_h = y1 - y0
    if face_w < 40 or face_h < 40:
        return None

    regions = [
        (
            x0 + int(face_w * 0.18),
            y0 + int(face_h * 0.18),
            x0 + int(face_w * 0.42),
            y0 + int(face_h * 0.40),
        ),
        (
            x0 + int(face_w * 0.56),
            y0 + int(face_h * 0.18),
            x0 + int(face_w * 0.82),
            y0 + int(face_h * 0.40),
        ),
        (
            x0 + int(face_w * 0.32),
            y0 + int(face_h * 0.10),
            x0 + int(face_w * 0.68),
            y0 + int(face_h * 0.26),
        ),
    ]

    values: list[np.ndarray] = []
    for rx0, ry0, rx1, ry1 in regions:
        rx0 = max(rx0, 0)
        ry0 = max(ry0, 0)
        rx1 = min(rx1, width)
        ry1 = min(ry1, height)
        if rx1 - rx0 < 8 or ry1 - ry0 < 8:
            continue
        patch = frame_rgb[ry0:ry1, rx0:rx1]
        if patch.size == 0:
            continue
        values.append(patch.reshape(-1, 3).mean(axis=0))
    if not values:
        return None
    return np.mean(np.asarray(values, dtype=np.float64), axis=0)


def _butter_bandpass(data: np.ndarray, fps: float, low_hz: float, high_hz: float) -> np.ndarray:
    signal = _signal_module()
    if len(data) < 12 or fps <= 1.0:
        return data
    nyquist = max(fps / 2.0, high_hz + 0.1)
    low = max(low_hz / nyquist, 1e-5)
    high = min(high_hz / nyquist, 0.99)
    if high <= low:
        return data
    b, a = signal.butter(3, [low, high], btype="bandpass")
    return signal.filtfilt(b, a, data)


def _chrom_signal(rgb_series: np.ndarray, fps: float) -> np.ndarray:
    if len(rgb_series) < 8:
        return np.zeros((0,), dtype=np.float64)
    rgb_series = _smooth_rgb_series(rgb_series)
    normalized = rgb_series / np.maximum(rgb_series.mean(axis=0, keepdims=True), 1e-6) - 1.0
    xs = 3 * normalized[:, 0] - 2 * normalized[:, 1]
    ys = 1.5 * normalized[:, 0] + normalized[:, 1] - 1.5 * normalized[:, 2]
    alpha = np.std(xs) / max(np.std(ys), 1e-6)
    chrom = xs - alpha * ys
    chrom = chrom - np.mean(chrom)
    signal = _signal_module()
    chrom = signal.detrend(chrom, type="linear")
    chrom = np.asarray(_moving_average(chrom.tolist(), window_size=3), dtype=np.float64)
    return _butter_bandpass(chrom, fps, settings.video_deception_hr_low_hz, settings.video_deception_hr_high_hz)


def _estimate_hr_track(signal_values: np.ndarray, fps: float) -> _HrTrack:
    if len(signal_values) < max(24, int(fps * 4)):
        return _HrTrack(times=[], bpm=[], quality=[])
    win_size = max(int(settings.video_deception_hr_window_seconds * fps), int(fps * 4))
    stride = max(int(settings.video_deception_hr_stride_seconds * fps), 1)
    min_hz = settings.video_deception_hr_low_hz
    max_hz = settings.video_deception_hr_high_hz
    times: list[float] = []
    bpm: list[float] = []
    quality: list[float] = []
    for start in range(0, max(len(signal_values) - win_size + 1, 1), stride):
        window = signal_values[start:start + win_size]
        if len(window) < win_size:
            continue
        window = window - np.mean(window)
        if np.std(window) < 1e-6:
            continue
        freqs = np.fft.rfftfreq(len(window), d=1.0 / fps)
        spec = np.abs(np.fft.rfft(window))
        mask = (freqs >= min_hz) & (freqs <= max_hz)
        if not np.any(mask):
            continue
        band_freqs = freqs[mask]
        band_spec = spec[mask]
        peak_index = int(np.argmax(band_spec))
        peak_hz = float(band_freqs[peak_index])
        peak_power = float(band_spec[peak_index])
        band_mean = float(np.mean(band_spec) + 1e-6)
        total_power = float(np.sum(band_spec) + 1e-6)
        quality_value = _clip01(((peak_power / band_mean) - 1.0) / 8.0)
        quality_value = max(quality_value, _clip01(peak_power / total_power * 4.0))
        quality.append(quality_value)
        bpm.append(peak_hz * 60.0)
        center_index = start + len(window) / 2.0
        times.append(center_index / fps)
    return _HrTrack(times=times, bpm=bpm, quality=quality)


def _derive_face_behavior_score(
    *,
    gaze_x: list[float],
    gaze_y: list[float],
    head_pitch: list[float],
    head_yaw: list[float],
    head_roll: list[float],
    eye_open: list[float],
    mouth_open: list[float],
    brow_raise: list[float],
    lip_tension: list[float],
) -> tuple[float, dict[str, float]]:
    gaze_score = _normalize_series_std(gaze_x, low=0.02, high=0.10) * 0.55 + _normalize_series_std(gaze_y, low=0.02, high=0.10) * 0.45
    head_score = (
        _normalize_series_std(head_yaw, low=2.5, high=14.0) * 0.5
        + _normalize_series_std(head_pitch, low=2.0, high=10.0) * 0.3
        + _normalize_series_std(head_roll, low=1.5, high=8.0) * 0.2
    )
    eye_score = _normalize_series_std(eye_open, low=0.01, high=0.05)
    mouth_score = _normalize_series_std(mouth_open, low=0.01, high=0.08)
    brow_score = _normalize_series_std(brow_raise, low=0.01, high=0.06)
    lip_score = _normalize_series_std(lip_tension, low=0.015, high=0.10)
    behavior_score = _clip01(gaze_score * 0.24 + head_score * 0.28 + eye_score * 0.16 + mouth_score * 0.14 + brow_score * 0.12 + lip_score * 0.06)
    components = {
        "gaze": round(float(gaze_score), 4),
        "head_motion": round(float(head_score), 4),
        "eye_variation": round(float(eye_score), 4),
        "mouth_variation": round(float(mouth_score), 4),
        "brow_variation": round(float(brow_score), 4),
        "lip_tension": round(float(lip_score), 4),
    }
    return behavior_score, components


def _derive_physiology_score(hr_track: _HrTrack) -> tuple[float, dict[str, float]]:
    quality = float(np.mean(hr_track.quality)) if hr_track.quality else 0.0
    if len(hr_track.bpm) < 2:
        return quality * 0.15, {"hr_std": 0.0, "quality": round(quality, 4), "hr_range": 0.0}
    hr_std = float(np.std(hr_track.bpm))
    hr_range = float(np.max(hr_track.bpm) - np.min(hr_track.bpm))
    score = _clip01(((hr_std - 2.0) / 8.0) * 0.5 + ((hr_range - 4.0) / 18.0) * 0.3 + quality * 0.2)
    return score, {
        "hr_std": round(hr_std, 4),
        "hr_range": round(hr_range, 4),
        "quality": round(quality, 4),
    }


def _risk_level(overall_score: float, confidence: float) -> str:
    adjusted = overall_score * (0.55 + 0.45 * confidence)
    if adjusted >= settings.video_deception_high_threshold:
        return "high"
    if adjusted >= settings.video_deception_medium_threshold:
        return "medium"
    return "low"


def _signal_level(score: float, *, medium: float = 0.45, high: float = 0.72) -> str:
    value = _safe_float(score)
    if value >= high:
        return "high"
    if value >= medium:
        return "medium"
    return "low"


def _trim_series(times: list[float], values: list[float]) -> tuple[list[float], list[float]]:
    usable = min(len(times), len(values))
    if usable <= 0:
        return [], []
    return times[:usable], values[:usable]


def _top_change_events(
    *,
    times: list[float],
    magnitudes: list[float],
    detail_values: list[dict[str, float]],
    event_type: str,
    title: str,
    description_template: str,
    min_magnitude: float,
    severity_medium: float,
    severity_high: float,
    top_k: int = 3,
    min_gap: int = 4,
) -> list[dict[str, Any]]:
    usable = min(len(times), len(magnitudes), len(detail_values))
    if usable <= 0:
        return []
    ranked = sorted(range(usable), key=lambda index: magnitudes[index], reverse=True)
    selected: list[int] = []
    events: list[dict[str, Any]] = []
    for index in ranked:
        magnitude = _safe_float(magnitudes[index])
        if magnitude < min_magnitude:
            continue
        if any(abs(index - chosen) < min_gap for chosen in selected):
            continue
        selected.append(index)
        severity = _signal_level(magnitude, medium=severity_medium, high=severity_high)
        events.append(
            {
                "time_sec": round(float(times[index]), 3),
                "type": event_type,
                "severity": severity,
                "title": title,
                "description": description_template.format(time=round(float(times[index]), 2), magnitude=round(magnitude, 3)),
                "evidence": {
                    "magnitude": round(magnitude, 4),
                    "details": {key: round(_safe_float(value), 4) for key, value in detail_values[index].items()},
                },
            }
        )
        if len(events) >= top_k:
            break
    return events


def _build_video_analysis(
    *,
    person_detected: bool,
    risk_level: str,
    confidence: float,
    signal_quality: float,
    face_behavior_score: float,
    physiology_score: float,
    behavior_components: dict[str, float],
    physiology_components: dict[str, float],
    blink_rate_per_min: float,
    hr_mean_bpm: float,
    hr_std_bpm: float,
    timestamps: list[float],
    gaze_x: list[float],
    gaze_y: list[float],
    head_pitch: list[float],
    head_yaw: list[float],
    head_roll: list[float],
    hr_track: _HrTrack,
) -> dict[str, Any]:
    if not person_detected:
        return {
            "overview": "当前片段未形成稳定人脸轨迹，因此没有进入行为波动与远程心率的深度解释阶段。",
            "findings": [],
            "timeline_events": [],
            "confidence_note": "本次结果主要由轻量验脸给出，未产生足够稳定的人脸序列用于行为/rPPG 解释。",
            "limitations": [
                "需要更连续、更清晰的人脸区域，才能生成行为与心率趋势解释。",
                "无人脸或人脸不稳定时，系统不会对情绪、真实度或欺骗行为做推断。",
            ],
        }

    findings: list[dict[str, Any]] = []

    def add_finding(
        *,
        dimension: str,
        score: float,
        title: str,
        description: str,
        evidence: dict[str, Any] | None = None,
    ) -> None:
        findings.append(
            {
                "dimension": dimension,
                "level": _signal_level(score),
                "title": title,
                "description": description,
                "evidence": evidence or {},
            }
        )

    gaze_score = _safe_float(behavior_components.get("gaze"))
    if gaze_score >= 0.35:
        add_finding(
            dimension="gaze",
            score=gaze_score,
            title="视线切换较频繁" if gaze_score >= 0.72 else "视线存在一定波动",
            description="眼神方向在片段内多次偏移，通常意味着注视点切换增多；它更适合作为注意力稳定性的辅助线索，而不直接代表说谎。",
            evidence={"component_score": round(gaze_score, 4)},
        )

    head_score = _safe_float(behavior_components.get("head_motion"))
    if head_score >= 0.35:
        add_finding(
            dimension="head_motion",
            score=head_score,
            title="头部姿态变化明显" if head_score >= 0.72 else "头部动作略多",
            description="头部偏航、俯仰或侧倾在多个时刻出现较快变化，常见于转头、点头、姿态调整，亦可能伴随追踪点短时抖动。",
            evidence={"component_score": round(head_score, 4)},
        )

    eye_score = _safe_float(behavior_components.get("eye_variation"))
    if eye_score >= 0.35 or blink_rate_per_min >= 24:
        add_finding(
            dimension="eyes",
            score=max(eye_score, _clip01(blink_rate_per_min / 40.0)),
            title="眼部开合波动偏高" if eye_score >= 0.72 or blink_rate_per_min >= 32 else "眼部变化可见",
            description="眨眼频率或眼睑开合变化较多，可能与说话、紧张、疲劳或光照变化有关，建议结合上下文理解。",
            evidence={
                "component_score": round(eye_score, 4),
                "blink_rate_per_min": round(float(blink_rate_per_min), 3),
            },
        )

    mouth_score = _safe_float(behavior_components.get("mouth_variation"))
    if mouth_score >= 0.45:
        add_finding(
            dimension="mouth",
            score=mouth_score,
            title="嘴部动作幅度较大",
            description="嘴部开合变化明显，通常对应说话节奏、停顿切换或表情变化，不建议单独作为风险结论。",
            evidence={"component_score": round(mouth_score, 4)},
        )

    if signal_quality < 0.18:
        add_finding(
            dimension="rppg_quality",
            score=1.0 - signal_quality,
            title="心率信号可信度有限",
            description="rPPG 信号质量偏低，更可能受光照、遮挡、压缩或面部运动干扰，本次心率相关解释只能作为弱辅助参考。",
            evidence={
                "quality": round(float(signal_quality), 4),
                "hr_mean_bpm": round(float(hr_mean_bpm), 3),
                "hr_std_bpm": round(float(hr_std_bpm), 3),
            },
        )
    elif physiology_score >= 0.35:
        add_finding(
            dimension="physiology",
            score=physiology_score,
            title="心率波动偏高" if physiology_score >= 0.72 else "心率存在一定起伏",
            description="非接触心率曲线出现可观波动，通常意味着生理唤醒变化增大；它不能替代医疗测量，也不直接等价于欺骗判断。",
            evidence={
                "score": round(float(physiology_score), 4),
                "hr_mean_bpm": round(float(hr_mean_bpm), 3),
                "hr_std_bpm": round(float(hr_std_bpm), 3),
                "hr_range": round(_safe_float(physiology_components.get("hr_range")), 4),
                "quality": round(float(signal_quality), 4),
            },
        )

    if not findings:
        add_finding(
            dimension="overall",
            score=max(face_behavior_score, physiology_score),
            title="整体波动较平稳",
            description="当前片段里眼神、头姿与心率曲线整体落在较稳定区间，可作为辅助参考，但不单独构成真实性结论。",
            evidence={
                "behavior_score": round(float(face_behavior_score), 4),
                "physiology_score": round(float(physiology_score), 4),
            },
        )

    gaze_times, gaze_x_values = _trim_series(timestamps, gaze_x)
    _, gaze_y_values = _trim_series(timestamps, gaze_y)
    gaze_magnitudes: list[float] = []
    gaze_details: list[dict[str, float]] = []
    gaze_event_times: list[float] = []
    usable_gaze = min(len(gaze_times), len(gaze_x_values), len(gaze_y_values))
    for index in range(1, usable_gaze):
        dx = _safe_float(gaze_x_values[index]) - _safe_float(gaze_x_values[index - 1])
        dy = _safe_float(gaze_y_values[index]) - _safe_float(gaze_y_values[index - 1])
        gaze_event_times.append(gaze_times[index])
        gaze_magnitudes.append(float(np.hypot(dx, dy)))
        gaze_details.append({"gaze_x_delta": dx, "gaze_y_delta": dy})

    head_times, pitch_values = _trim_series(timestamps, head_pitch)
    _, yaw_values = _trim_series(timestamps, head_yaw)
    _, roll_values = _trim_series(timestamps, head_roll)
    head_magnitudes: list[float] = []
    head_details: list[dict[str, float]] = []
    head_event_times: list[float] = []
    usable_head = min(len(head_times), len(pitch_values), len(yaw_values), len(roll_values))
    for index in range(1, usable_head):
        dp = _safe_float(pitch_values[index]) - _safe_float(pitch_values[index - 1])
        dy = _safe_float(yaw_values[index]) - _safe_float(yaw_values[index - 1])
        dr = _safe_float(roll_values[index]) - _safe_float(roll_values[index - 1])
        head_event_times.append(head_times[index])
        head_magnitudes.append(float(np.sqrt(dp * dp + dy * dy + dr * dr)))
        head_details.append({"pitch_delta": dp, "yaw_delta": dy, "roll_delta": dr})

    hr_times, hr_values = _trim_series(hr_track.times, hr_track.bpm)
    hr_magnitudes: list[float] = []
    hr_details: list[dict[str, float]] = []
    hr_event_times: list[float] = []
    for index in range(1, min(len(hr_times), len(hr_values))):
        delta = _safe_float(hr_values[index]) - _safe_float(hr_values[index - 1])
        hr_event_times.append(hr_times[index])
        hr_magnitudes.append(abs(delta))
        hr_details.append({"hr_bpm_delta": delta})

    timeline_events = [
        *_top_change_events(
            times=gaze_event_times,
            magnitudes=gaze_magnitudes,
            detail_values=gaze_details,
            event_type="gaze_shift",
            title="视线突然偏移",
            description_template="约 {time}s 附近出现较明显的注视点切换，可能对应快速看向别处、重新对焦，或短时追踪不稳。",
            min_magnitude=0.16,
            severity_medium=0.24,
            severity_high=0.42,
        ),
        *_top_change_events(
            times=head_event_times,
            magnitudes=head_magnitudes,
            detail_values=head_details,
            event_type="head_motion_burst",
            title="头部动作突然增大",
            description_template="约 {time}s 附近头部姿态变化增大，常见于转头、点头或身体姿态重新调整。",
            min_magnitude=8.0,
            severity_medium=12.0,
            severity_high=20.0,
        ),
    ]

    if signal_quality >= 0.18:
        timeline_events.extend(
            _top_change_events(
                times=hr_event_times,
                magnitudes=hr_magnitudes,
                detail_values=hr_details,
                event_type="hr_swing",
                title="心率估计出现短时跃变",
                description_template="约 {time}s 附近心率估计值发生较快变化，可能反映短时生理唤醒变化，也可能受运动/光照干扰。",
                min_magnitude=5.0,
                severity_medium=8.0,
                severity_high=12.0,
                top_k=2,
                min_gap=2,
            )
        )

    timeline_events.sort(key=lambda item: float(item.get("time_sec") or 0.0))
    if len(timeline_events) > 6:
        timeline_events = timeline_events[:6]

    overview_parts: list[str] = []
    if risk_level == "high":
        overview_parts.append("本段视频中的行为或生理波动较明显。")
    elif risk_level == "medium":
        overview_parts.append("本段视频存在一定行为或生理起伏。")
    else:
        overview_parts.append("本段视频中的行为与生理信号整体较平稳。")

    lead_titles = [str(item.get("title") or "").strip() for item in findings[:2] if str(item.get("title") or "").strip()]
    if lead_titles:
        overview_parts.append(f"主要线索集中在：{'、'.join(lead_titles)}。")
    if signal_quality < 0.18:
        overview_parts.append("由于 rPPG 质量有限，解释更偏向眼神与头姿。")
    elif physiology_score >= 0.35:
        overview_parts.append("心率波动解释可作为辅助参考，但不能脱离画面语境单独使用。")

    limitations = [
        "行为波动只反映动作与生理起伏，不直接等价于欺骗、紧张或特定情绪。",
        "rPPG 属于非接触估计，易受光照、遮挡、压缩和头部运动影响，不能替代医疗设备。",
    ]

    if blink_rate_per_min <= 0:
        limitations.append("当前片段眨眼统计样本较少，眼部解释更适合作为趋势参考。")

    return {
        "overview": " ".join(overview_parts),
        "findings": findings[:4],
        "timeline_events": timeline_events,
        "confidence_note": (
            f"当前解释置信度约为 {round(float(confidence) * 100)}%，"
            + ("以行为特征为主。" if signal_quality < 0.18 else "行为与 rPPG 信号共同参与。")
        ),
        "limitations": limitations,
    }


def _friendly_reason(
    *,
    person_detected: bool,
    risk_level: str,
    face_behavior_score: float,
    physiology_score: float,
    quality: float,
) -> tuple[str, str]:
    if not person_detected:
        return (
            "未检测到稳定人脸，已跳过行为与非接触心率分析。",
            "当前片段中未找到连续可用的人脸区域，因此没有生成人物行为/生理辅助结果。",
        )
    if quality < 0.18:
        return (
            "检测到人脸，但心率信号质量较低，本次结果更依赖眼神与头动特征。",
            "当前虽然存在人脸区域，但 rPPG 信号有限，因此结果主要来自眼神、头姿和面部代理特征。",
        )
    if risk_level == "high":
        return (
            "检测到明显的人物行为/生理异常波动，建议继续人工复核。",
            f"行为分 {face_behavior_score:.2f}，生理分 {physiology_score:.2f}；两路信号均明显偏高。",
        )
    if risk_level == "medium":
        return (
            "检测到一定的人物行为或生理波动，建议人工复核。",
            f"行为分 {face_behavior_score:.2f}，生理分 {physiology_score:.2f}；可作为辅助风险证据。",
        )
    return (
        "人物行为与非接触心率波动整体平稳。",
        f"行为分 {face_behavior_score:.2f}，生理分 {physiology_score:.2f}；当前未见明显异常波动。",
    )


def precheck_video_face_presence(video_path: Path, *, source_path: str | None = None) -> dict[str, Any]:
    if not settings.video_deception_enabled:
        raise RuntimeError("Video deception detector is disabled by configuration.")

    mp = _mediapipe_module()
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")

    fps_raw = _safe_float(capture.get(cv2.CAP_PROP_FPS), 25.0)
    fps = fps_raw if fps_raw > 0 else 25.0
    frame_count = int(_safe_float(capture.get(cv2.CAP_PROP_FRAME_COUNT), 0))
    duration = frame_count / fps if frame_count > 0 and fps > 0 else 0.0
    max_duration = min(float(settings.video_deception_max_duration_seconds), _FACE_PRECHECK_MAX_DURATION_SECONDS)
    if max_duration > 0 and duration > max_duration:
        max_frames = int(max_duration * fps)
    else:
        max_frames = frame_count if frame_count > 0 else 0
    target_fps = max(min(float(settings.video_deception_target_fps), _FACE_PRECHECK_TARGET_FPS), 1.0)
    stride = max(int(round(fps / target_fps)), 1)

    sampled_frames = 0
    face_frames = 0
    processed_frame_index = 0
    min_face_frames = max(1, min(int(settings.video_deception_min_face_frames), _FACE_PRECHECK_MIN_FACE_FRAMES))

    with _create_face_landmarker(output_face_blendshapes=False) as face_landmarker:
        while True:
            ok, frame_bgr = capture.read()
            if not ok:
                break
            if max_frames and processed_frame_index >= max_frames:
                break
            if processed_frame_index % stride != 0:
                processed_frame_index += 1
                continue

            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            height, width = frame_rgb.shape[:2]
            timestamp = processed_frame_index / fps
            sampled_frames += 1

            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            result = face_landmarker.detect_for_video(mp_image, int(round(timestamp * 1000.0)))
            if result.face_landmarks:
                landmarks = result.face_landmarks[0]
                if _is_face_box_large_enough(_face_box(landmarks, width, height), width, height):
                    face_frames += 1

            if face_frames >= min_face_frames:
                current_ratio = face_frames / max(sampled_frames, 1)
                if current_ratio >= _FACE_PRECHECK_MIN_FACE_RATIO:
                    break

            processed_frame_index += 1

    capture.release()

    analyzed_fps = fps / stride if stride else fps
    face_ratio = face_frames / max(sampled_frames, 1)
    person_detected = face_frames >= min_face_frames and face_ratio >= _FACE_PRECHECK_MIN_FACE_RATIO
    if person_detected:
        summary = "检测到稳定人脸候选，将继续进行行为与 rPPG 精检。"
        final_reason = (
            f"轻量验脸阶段在 {sampled_frames} 个采样帧中检测到 {face_frames} 帧有效人脸，"
            "满足后续行为/rPPG 分析条件。"
        )
    else:
        summary = "未检测到稳定人脸，已跳过行为与 rPPG 精检。"
        final_reason = (
            f"轻量验脸阶段仅检测到 {face_frames} / {sampled_frames} 帧有效人脸，"
            "不足以支持后续行为/rPPG 分析。"
        )

    return {
        "file_path": source_path or str(video_path),
        "file_name": video_path.name,
        "status": "completed",
        "error_message": None,
        "model_name": f"{MODEL_LABEL} (FacePrecheck)",
        "person_detected": bool(person_detected),
        "sampled_fps": round(float(analyzed_fps), 3),
        "sampled_frames": int(sampled_frames),
        "face_frames": int(face_frames),
        "face_frame_ratio": round(float(face_ratio), 4),
        "duration_sec": round(float(min(duration, max_duration) if max_duration > 0 else duration), 3),
        "summary": summary,
        "final_reason": final_reason,
    }


def analyze_video_file(video_path: Path, *, source_path: str | None = None) -> dict[str, Any]:
    if not settings.video_deception_enabled:
        raise RuntimeError("Video deception detector is disabled by configuration.")

    mp = _mediapipe_module()
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")
    fps_raw = _safe_float(capture.get(cv2.CAP_PROP_FPS), 25.0)
    fps = fps_raw if fps_raw > 0 else 25.0
    frame_count = int(_safe_float(capture.get(cv2.CAP_PROP_FRAME_COUNT), 0))
    duration = frame_count / fps if frame_count > 0 and fps > 0 else 0.0
    if settings.video_deception_max_duration_seconds > 0 and duration > settings.video_deception_max_duration_seconds:
        max_frames = int(settings.video_deception_max_duration_seconds * fps)
    else:
        max_frames = frame_count if frame_count > 0 else 0
    target_fps = max(float(settings.video_deception_target_fps), 1.0)
    stride = max(int(round(fps / target_fps)), 1)

    timestamps: list[float] = []
    gaze_x: list[float] = []
    gaze_y: list[float] = []
    head_pitch: list[float] = []
    head_yaw: list[float] = []
    head_roll: list[float] = []
    eye_open: list[float] = []
    mouth_open: list[float] = []
    brow_raise: list[float] = []
    lip_tension: list[float] = []
    rgb_series: list[np.ndarray] = []

    sampled_frames = 0
    face_frames = 0
    processed_frame_index = 0
    with _create_face_landmarker() as face_landmarker:
        while True:
            ok, frame_bgr = capture.read()
            if not ok:
                break
            if max_frames and processed_frame_index >= max_frames:
                break
            if processed_frame_index % stride != 0:
                processed_frame_index += 1
                continue

            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            height, width = frame_rgb.shape[:2]
            timestamp = processed_frame_index / fps
            sampled_frames += 1

            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            result = face_landmarker.detect_for_video(mp_image, int(round(timestamp * 1000.0)))

            if result.face_landmarks:
                landmarks = result.face_landmarks[0]
                behavior = _extract_behavior_features(landmarks, width, height)
                if behavior is not None:
                    pose = _head_pose_angles(landmarks, width, height)
                    if pose is not None:
                        face_box = _face_box(landmarks, width, height)
                        if _is_frame_quality_valid(behavior, face_box, width, height):
                            pitch, yaw, roll = pose
                            head_pitch.append(pitch)
                            head_yaw.append(yaw)
                            head_roll.append(roll)
                            gaze_x.append(_clip(behavior["gaze_x"], -_GAZE_ABS_LIMIT, _GAZE_ABS_LIMIT))
                            gaze_y.append(_clip(behavior["gaze_y"], -_GAZE_ABS_LIMIT, _GAZE_ABS_LIMIT))
                            eye_open.append(behavior["eye_open"])
                            mouth_open.append(behavior["mouth_open"])
                            brow_raise.append(behavior["brow_raise"])
                            lip_tension.append(behavior["lip_tension"])
                            rgb = _extract_rppg_rgb(frame_rgb, landmarks, width, height)
                            if rgb is not None:
                                rgb_series.append(rgb)
                            timestamps.append(timestamp)
                            face_frames += 1

            processed_frame_index += 1
    capture.release()

    analyzed_fps = fps / stride if stride else fps
    face_ratio = face_frames / max(sampled_frames, 1)
    person_detected = face_frames >= max(int(settings.video_deception_min_face_frames), 8)

    if face_frames:
        gaze_x = _smooth_series(gaze_x, clip_low=-_GAZE_ABS_LIMIT, clip_high=_GAZE_ABS_LIMIT)
        gaze_y = _smooth_series(gaze_y, clip_low=-_GAZE_ABS_LIMIT, clip_high=_GAZE_ABS_LIMIT)
        head_pitch = _smooth_series(_relative_angle_series(head_pitch), clip_low=-_HEAD_MOTION_PITCH_LIMIT, clip_high=_HEAD_MOTION_PITCH_LIMIT)
        head_yaw = _smooth_series(_relative_angle_series(head_yaw), clip_low=-_HEAD_MOTION_YAW_LIMIT, clip_high=_HEAD_MOTION_YAW_LIMIT)
        head_roll = _smooth_series(_relative_angle_series(head_roll), clip_low=-_HEAD_MOTION_ROLL_LIMIT, clip_high=_HEAD_MOTION_ROLL_LIMIT)
        eye_open = _smooth_series(eye_open, clip_low=0.0, clip_high=0.65)
        mouth_open = _smooth_series(mouth_open, clip_low=0.0, clip_high=0.85)
        brow_raise = _smooth_series(brow_raise, clip_low=0.0, clip_high=1.8)
        lip_tension = _smooth_series(lip_tension, clip_low=0.0, clip_high=1.0)

    hr_signal_values: np.ndarray = np.zeros((0,), dtype=np.float64)
    hr_track = _HrTrack(times=[], bpm=[], quality=[])
    if person_detected and len(rgb_series) >= max(int(analyzed_fps * 4), 24):
        rgb_array = np.asarray(rgb_series, dtype=np.float64)
        hr_signal_values = _chrom_signal(rgb_array, analyzed_fps)
        hr_track = _estimate_hr_track(hr_signal_values, analyzed_fps)

    if person_detected:
        face_behavior_score, behavior_components = _derive_face_behavior_score(
            gaze_x=gaze_x,
            gaze_y=gaze_y,
            head_pitch=head_pitch,
            head_yaw=head_yaw,
            head_roll=head_roll,
            eye_open=eye_open,
            mouth_open=mouth_open,
            brow_raise=brow_raise,
            lip_tension=lip_tension,
        )
        physiology_score, physiology_components = _derive_physiology_score(hr_track)
    else:
        face_behavior_score, behavior_components = 0.0, {
            "gaze": 0.0,
            "head_motion": 0.0,
            "eye_variation": 0.0,
            "mouth_variation": 0.0,
            "brow_variation": 0.0,
            "lip_tension": 0.0,
        }
        physiology_score, physiology_components = 0.0, {
            "hr_std": 0.0,
            "hr_range": 0.0,
            "quality": 0.0,
        }

    signal_quality = physiology_components.get("quality", 0.0)
    confidence = _clip01(face_ratio * 0.65 + signal_quality * 0.35)
    if not person_detected:
        confidence = max(confidence, 0.25)
    overall_score = _clip01(face_behavior_score * 0.62 + physiology_score * 0.38)
    risk_level = _risk_level(overall_score, confidence) if person_detected else "low"
    summary, final_reason = _friendly_reason(
        person_detected=person_detected,
        risk_level=risk_level,
        face_behavior_score=face_behavior_score,
        physiology_score=physiology_score,
        quality=signal_quality,
    )

    hr_mean = float(np.mean(hr_track.bpm)) if hr_track.bpm else 0.0
    hr_std = float(np.std(hr_track.bpm)) if hr_track.bpm else 0.0
    blink_events = 0
    if len(eye_open) >= 3:
        blink_threshold = float(np.quantile(np.asarray(eye_open, dtype=np.float64), 0.18))
        for index in range(1, len(eye_open) - 1):
            if eye_open[index] < blink_threshold and eye_open[index] <= eye_open[index - 1] and eye_open[index] <= eye_open[index + 1]:
                blink_events += 1
    blink_rate_per_min = blink_events / max((timestamps[-1] - timestamps[0]) / 60.0, 1.0 / 60.0) if len(timestamps) >= 2 else 0.0
    analysis = _build_video_analysis(
        person_detected=person_detected,
        risk_level=risk_level,
        confidence=confidence,
        signal_quality=signal_quality,
        face_behavior_score=face_behavior_score,
        physiology_score=physiology_score,
        behavior_components=behavior_components,
        physiology_components=physiology_components,
        blink_rate_per_min=blink_rate_per_min,
        hr_mean_bpm=hr_mean,
        hr_std_bpm=hr_std,
        timestamps=timestamps,
        gaze_x=gaze_x,
        gaze_y=gaze_y,
        head_pitch=head_pitch,
        head_yaw=head_yaw,
        head_roll=head_roll,
        hr_track=hr_track,
    )

    return {
        "file_path": source_path or str(video_path),
        "file_name": video_path.name,
        "status": "completed",
        "error_message": None,
        "model_name": MODEL_LABEL,
        "landmarker_model_path": str(_face_landmarker_model_path()),
        "person_detected": bool(person_detected),
        "sampled_fps": round(float(analyzed_fps), 3),
        "sampled_frames": int(sampled_frames),
        "face_frames": int(face_frames),
        "face_frame_ratio": round(float(face_ratio), 4),
        "duration_sec": round(float(duration), 3),
        "confidence": round(float(confidence), 4),
        "face_behavior_score": round(float(face_behavior_score), 4),
        "physiology_score": round(float(physiology_score), 4),
        "overall_score": round(float(overall_score), 4),
        "risk_level": risk_level,
        "signal_quality": round(float(signal_quality), 4),
        "hr_mean_bpm": round(float(hr_mean), 3),
        "hr_std_bpm": round(float(hr_std), 3),
        "blink_rate_per_min": round(float(blink_rate_per_min), 3),
        "behavior_components": behavior_components,
        "physiology_components": physiology_components,
        "series": {
            "gaze_x": _series_payload(timestamps, gaze_x),
            "gaze_y": _series_payload(timestamps, gaze_y),
            "head_pitch": _series_payload(timestamps, head_pitch),
            "head_yaw": _series_payload(timestamps, head_yaw),
            "head_roll": _series_payload(timestamps, head_roll),
            "hr_bpm": _series_payload(hr_track.times, hr_track.bpm, max_points=60),
            "rppg_signal": _series_payload(
                [index / analyzed_fps for index in range(len(hr_signal_values))],
                hr_signal_values.tolist(),
            ),
        },
        "summary": summary,
        "final_reason": final_reason,
        "analysis": analysis,
        "raw": {
            "target_fps": float(settings.video_deception_target_fps),
            "hr_window_seconds": float(settings.video_deception_hr_window_seconds),
            "hr_stride_seconds": float(settings.video_deception_hr_stride_seconds),
        },
    }


def analyze_video_batch(video_paths: list[tuple[str, Path]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for source_path, absolute_path in video_paths:
        try:
            items.append(analyze_video_file(absolute_path, source_path=source_path))
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {
                    "file_path": source_path,
                    "file_name": absolute_path.name,
                    "status": "failed",
                    "error_message": str(exc),
                }
            )

    lead_item: dict[str, Any] | None = None
    overall = "low"
    for item in items:
        level = str(item.get("risk_level") or "low")
        if _risk_rank(level) > _risk_rank(overall):
            overall = level
            lead_item = item
    if lead_item is None and items:
        lead_item = items[0]

    if not items:
        overall_summary = "人物行为 / 非接触心率分析未能完成。"
    elif overall == "high":
        overall_summary = "检测到明显的人物行为 / 生理异常，建议继续人工交互复核。"
    elif overall == "medium":
        overall_summary = "检测到一定的人物行为或生理波动，可作为辅助风险证据。"
    else:
        overall_summary = "人物行为与非接触心率波动整体平稳，可作为辅助参考。"

    return {
        "items": items,
        "failed_items": failures,
        "summary": {
            "model_name": MODEL_LABEL,
            "total_count": len(video_paths),
            "analyzed_count": len(items),
            "failed_count": len(failures),
            "person_detected_count": sum(1 for item in items if bool(item.get("person_detected"))),
            "overall_risk_level": overall,
            "overall_summary": overall_summary,
            "lead_item": lead_item,
        },
    }


def precheck_video_batch(video_paths: list[tuple[str, Path]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for source_path, absolute_path in video_paths:
        try:
            items.append(precheck_video_face_presence(absolute_path, source_path=source_path))
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {
                    "file_path": source_path,
                    "file_name": absolute_path.name,
                    "status": "failed",
                    "error_message": str(exc),
                    "person_detected": False,
                }
            )

    detected_items = [item for item in items if bool(item.get("person_detected"))]
    skipped_no_face_count = len(video_paths) - len(detected_items)
    overall_summary = (
        f"轻量验脸完成：{len(detected_items)} 段视频检测到稳定人脸，"
        f"{max(skipped_no_face_count, 0)} 段视频将直接跳过行为/rPPG 精检。"
    )
    return {
        "items": items,
        "failed_items": failures,
        "summary": {
            "model_name": f"{MODEL_LABEL} (FacePrecheck)",
            "total_count": len(video_paths),
            "analyzed_count": len(items),
            "failed_count": len(failures),
            "person_detected_count": len(detected_items),
            "skipped_no_face_count": max(skipped_no_face_count, 0),
            "overall_risk_level": "low",
            "overall_summary": overall_summary,
            "lead_item": detected_items[0] if detected_items else None,
        },
    }
