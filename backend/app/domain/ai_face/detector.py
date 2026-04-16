"""SelfBlendedImages 多人脸推理封装。"""
from __future__ import annotations

import io
from pathlib import Path
from threading import Lock
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image
from torch import nn

from app.domain.ai_face.efficientnet_pytorch import EfficientNet
from app.domain.ai_face.retinaface.predict_single import Model as RetinaFaceModel


def resolve_device(device_name: str | None = None) -> torch.device:
    if device_name in (None, "", "auto"):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device_name == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available, but device=cuda was requested.")
    return torch.device(device_name)


class _SBIClassifier(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        try:
            self.net = EfficientNet.from_name("efficientnet-b4", num_classes=2)
        except TypeError:
            self.net = EfficientNet.from_name(
                "efficientnet-b4",
                override_params={"num_classes": 2},
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def crop_face(
    img: np.ndarray,
    landmark: np.ndarray | None = None,
    bbox: np.ndarray | None = None,
    margin: bool = False,
    crop_by_bbox: bool = True,
    abs_coord: bool = False,
    only_img: bool = False,
    phase: str = "train",
):
    assert phase in ["train", "val", "test"]
    assert landmark is not None or bbox is not None

    height, width = len(img), len(img[0])

    if crop_by_bbox:
        x0, y0 = bbox[0]
        x1, y1 = bbox[1]
        w = x1 - x0
        h = y1 - y0
        w0_margin = w / 4
        w1_margin = w / 4
        h0_margin = h / 4
        h1_margin = h / 4
    else:
        x0, y0 = landmark[:68, 0].min(), landmark[:68, 1].min()
        x1, y1 = landmark[:68, 0].max(), landmark[:68, 1].max()
        w = x1 - x0
        h = y1 - y0
        w0_margin = w / 8
        w1_margin = w / 8
        h0_margin = h / 2
        h1_margin = h / 5

    if margin:
        w0_margin *= 4
        w1_margin *= 4
        h0_margin *= 2
        h1_margin *= 2
    elif phase == "train":
        w0_margin *= np.random.rand() * 0.6 + 0.2
        w1_margin *= np.random.rand() * 0.6 + 0.2
        h0_margin *= np.random.rand() * 0.6 + 0.2
        h1_margin *= np.random.rand() * 0.6 + 0.2
    else:
        w0_margin *= 0.5
        w1_margin *= 0.5
        h0_margin *= 0.5
        h1_margin *= 0.5

    y0_new = max(0, int(y0 - h0_margin))
    y1_new = min(height, int(y1 + h1_margin) + 1)
    x0_new = max(0, int(x0 - w0_margin))
    x1_new = min(width, int(x1 + w1_margin) + 1)

    img_cropped = img[y0_new:y1_new, x0_new:x1_new]

    if landmark is not None:
        landmark_cropped = np.zeros_like(landmark)
        for i, (p, q) in enumerate(landmark):
            landmark_cropped[i] = [p - x0_new, q - y0_new]
    else:
        landmark_cropped = None

    if bbox is not None:
        bbox_cropped = np.zeros_like(bbox)
        for i, (p, q) in enumerate(bbox):
            bbox_cropped[i] = [p - x0_new, q - y0_new]
    else:
        bbox_cropped = None

    if only_img:
        return img_cropped
    if abs_coord:
        return (
            img_cropped,
            landmark_cropped,
            bbox_cropped,
            (y0 - y0_new, x0 - x0_new, y1_new - y1, x1_new - x1),
            y0_new,
            y1_new,
            x0_new,
            x1_new,
        )
    return img_cropped, landmark_cropped, bbox_cropped, (y0 - y0_new, x0 - x0_new, y1_new - y1, x1_new - x1)


def _normalize_landmarks(landmarks: list[list[float]] | np.ndarray | None) -> list[list[float]]:
    if landmarks is None:
        return []
    arr = np.asarray(landmarks, dtype=np.float32)
    if arr.size == 0:
        return []
    return [[float(x), float(y)] for x, y in arr.reshape(-1, 2)]


def _normalize_detected_faces(faces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_faces = []
    for face_idx, face in enumerate(faces):
        bbox = face.get("bbox", [])
        if bbox is None or len(bbox) != 4:
            continue
        x0, y0, x1, y1 = [float(v) for v in bbox]
        if x1 <= x0 or y1 <= y0:
            continue
        normalized_faces.append(
            {
                "face_id": int(face_idx),
                "bbox": [x0, y0, x1, y1],
                "det_score": float(face.get("score", -1.0)),
                "landmarks": _normalize_landmarks(face.get("landmarks", [])),
            }
        )
    return normalized_faces


def _extract_faces(
    frame_rgb: np.ndarray,
    face_detector: RetinaFaceModel,
    image_size: tuple[int, int] = (380, 380),
    confidence_threshold: float = 0.7,
    nms_threshold: float = 0.4,
) -> tuple[list[np.ndarray], list[dict[str, Any]]]:
    faces = face_detector.predict_jsons(
        frame_rgb,
        confidence_threshold=confidence_threshold,
        nms_threshold=nms_threshold,
    )
    faces = _normalize_detected_faces(faces)

    cropped_faces: list[np.ndarray] = []
    face_infos: list[dict[str, Any]] = []
    for face in faces:
        x0, y0, x1, y1 = face["bbox"]
        bbox = np.array([[x0, y0], [x1, y1]], dtype=np.float32)
        cropped = crop_face(
            frame_rgb,
            None,
            bbox,
            False,
            crop_by_bbox=True,
            only_img=True,
            phase="test",
        )
        cropped = cv2.resize(cropped, dsize=image_size).transpose((2, 0, 1))
        cropped_faces.append(cropped)
        face_infos.append(
            {
                "face_id": int(face["face_id"]),
                "bbox": [int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))],
                "det_score": float(face["det_score"]),
                "landmarks": face["landmarks"],
            }
        )
    return cropped_faces, face_infos


class SBIMultiFaceDetector:
    """可直接在后端 import 使用的 SBI 多人脸检测器。"""

    def __init__(
        self,
        *,
        sbi_weight_path: str | Path,
        retinaface_weight_path: str | Path,
        device: str = "auto",
        fake_threshold: float = 0.5,
        face_confidence_threshold: float = 0.7,
        face_nms_threshold: float = 0.4,
        retinaface_max_size: int = 4096,
        backend_name: str = "local_sbi_multiface",
        model_name: str | None = None,
        face_detector_name: str | None = None,
    ) -> None:
        self.sbi_weight_path = Path(sbi_weight_path).resolve()
        self.retinaface_weight_path = Path(retinaface_weight_path).resolve()
        self.device = resolve_device(device)
        self.fake_threshold = float(fake_threshold)
        self.face_confidence_threshold = float(face_confidence_threshold)
        self.face_nms_threshold = float(face_nms_threshold)
        self.retinaface_max_size = int(retinaface_max_size)
        self.backend_name = backend_name
        self.model_name = model_name or self.sbi_weight_path.name
        self.face_detector_name = face_detector_name or self.retinaface_weight_path.name
        self._predict_lock = Lock()

        self._classifier = self._load_classifier()
        self._face_detector = self._load_face_detector()

    def _torch_load(self, path: Path, map_location: str | torch.device):
        try:
            return torch.load(path, map_location=map_location, weights_only=False)
        except TypeError:
            return torch.load(path, map_location=map_location)

    def _load_classifier(self) -> _SBIClassifier:
        if not self.sbi_weight_path.is_file():
            raise RuntimeError(f"SBI 权重不存在: {self.sbi_weight_path}")
        checkpoint = self._torch_load(self.sbi_weight_path, self.device)
        model = _SBIClassifier().to(self.device)
        model.load_state_dict(checkpoint["model"])
        model.eval()
        return model

    def _load_face_detector(self) -> RetinaFaceModel:
        if not self.retinaface_weight_path.is_file():
            raise RuntimeError(f"RetinaFace 权重不存在: {self.retinaface_weight_path}")
        state_dict = self._torch_load(self.retinaface_weight_path, "cpu")
        detector = RetinaFaceModel(max_size=self.retinaface_max_size, device=str(self.device))
        detector.load_state_dict(state_dict)
        detector.eval()
        return detector

    def _infer_face_scores(self, face_crops: list[np.ndarray]) -> list[float]:
        if len(face_crops) == 0:
            return []
        face_array = np.asarray(face_crops, dtype=np.float32) / 255.0
        img = torch.from_numpy(face_array).to(self.device)
        with torch.no_grad():
            scores = self._classifier(img).softmax(dim=1)[:, 1].detach().cpu().numpy()
        return [float(score) for score in scores]

    def _build_result(
        self,
        *,
        source: str | None,
        image_shape: tuple[int, ...],
        face_infos: list[dict[str, Any]],
        face_scores: list[float],
    ) -> dict[str, Any]:
        faces = []
        for info, score in zip(face_infos, face_scores):
            label = "fake" if score >= self.fake_threshold else "real"
            faces.append(
                {
                    "face_id": int(info["face_id"]),
                    "bbox": [int(v) for v in info["bbox"]],
                    "det_score": float(info["det_score"]),
                    "fake_score": float(score),
                    "label": label,
                    "landmarks": [
                        [float(point[0]), float(point[1])]
                        for point in info.get("landmarks", [])
                    ],
                }
            )

        image_fake_score = max((face["fake_score"] for face in faces), default=None)
        status = "ok" if faces else "no_face"
        if image_fake_score is None:
            prediction = "real"
            fake_probability = 0.0
            real_probability = 0.0
            confidence = 0.0
            message = "No face detected."
        else:
            prediction = "fake" if image_fake_score >= self.fake_threshold else "real"
            fake_probability = float(image_fake_score)
            real_probability = float(max(0.0, min(1.0, 1.0 - image_fake_score)))
            confidence = fake_probability if prediction == "fake" else real_probability
            message = "ok"

        height, width = image_shape[:2]
        return {
            "status": status,
            "message": message,
            "source": source or "",
            "prediction": prediction,
            "is_ai_face": prediction == "fake",
            "confidence": float(confidence),
            "fake_probability": float(fake_probability),
            "real_probability": float(real_probability),
            "image_fake_score": None if image_fake_score is None else float(image_fake_score),
            "raw_label": prediction,
            "model": self.model_name,
            "face_detector_model": self.face_detector_name,
            "backend": self.backend_name,
            "device": str(self.device),
            "threshold": float(self.fake_threshold),
            "num_faces": int(len(faces)),
            "image_size": {"width": int(width), "height": int(height)},
            "faces": faces,
        }

    def predict_image_rgb(self, image_rgb: np.ndarray, *, source: str | None = None) -> dict[str, Any]:
        if image_rgb is None or image_rgb.size == 0:
            raise ValueError("图片内容不能为空")
        with self._predict_lock:
            face_crops, face_infos = _extract_faces(
                image_rgb,
                self._face_detector,
                confidence_threshold=self.face_confidence_threshold,
                nms_threshold=self.face_nms_threshold,
            )
            face_scores = self._infer_face_scores(face_crops)
        return self._build_result(source=source, image_shape=image_rgb.shape, face_infos=face_infos, face_scores=face_scores)

    def predict_image_bgr(self, image_bgr: np.ndarray, *, source: str | None = None) -> dict[str, Any]:
        if image_bgr is None or image_bgr.size == 0:
            raise ValueError("图片内容不能为空")
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        return self.predict_image_rgb(image_rgb, source=source)

    def predict_image_path(self, image_path: str | Path) -> dict[str, Any]:
        image_path = Path(image_path)
        image_bgr = cv2.imread(str(image_path))
        if image_bgr is None:
            raise ValueError(f"图片读取失败: {image_path}")
        return self.predict_image_bgr(image_bgr, source=str(image_path.resolve()))

    def predict_image_bytes(self, image_bytes: bytes, *, filename: str | None = None) -> dict[str, Any]:
        if not image_bytes:
            raise ValueError("图片内容不能为空")
        try:
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            raise ValueError("图片解码失败，请检查文件格式") from exc
        image_rgb = np.array(image)
        return self.predict_image_rgb(image_rgb, source=filename or "")

    @staticmethod
    def draw_result(image_bgr: np.ndarray, result: dict[str, Any]) -> np.ndarray:
        vis = image_bgr.copy()
        for face in result.get("faces", []):
            x0, y0, x1, y1 = [int(v) for v in face["bbox"]]
            color = (0, 0, 255) if face["label"] == "fake" else (0, 200, 0)
            text = f"#{face['face_id']} {face['label']} {face['fake_score']:.4f}"

            cv2.rectangle(vis, (x0, y0), (x1, y1), color, 2)
            (text_width, text_height), baseline = cv2.getTextSize(
                text,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                1,
            )
            text_y0 = max(0, y0 - text_height - baseline - 6)
            text_y1 = text_y0 + text_height + baseline + 6
            text_x1 = min(vis.shape[1], x0 + text_width + 6)
            cv2.rectangle(vis, (x0, text_y0), (text_x1, text_y1), color, -1)
            cv2.putText(
                vis,
                text,
                (x0 + 3, text_y1 - baseline - 3),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )
        return vis
