"""AI 换脸识别领域模块。"""

from app.domain.ai_face.service import detect_ai_face, detect_ai_face_and_store, get_ai_face_detector

__all__ = ["detect_ai_face", "detect_ai_face_and_store", "get_ai_face_detector"]
