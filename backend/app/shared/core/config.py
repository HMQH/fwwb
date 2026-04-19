"""从环境变量 / .env 读取配置。"""
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[3]


def _default_upload_root() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "uploads")


def _default_user_memory_root() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "user-memory")


def _default_threatbook_storage_state_path() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "threatbook" / "storage_state.json")


def _default_image_fraud_reference_dir() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "fraud_source" / "image_fraud")


def _default_image_fraud_cache_path() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "image-fraud" / "reference-index.pt")


def _default_audio_linear_model_path() -> str:
    return str(_BACKEND_ROOT / "models" / "call_intervention" / "linear_model.json")


def _default_phone_risk_prefix_profile_path() -> str:
    return str(_BACKEND_ROOT / "models" / "call_intervention" / "phone_prefix_profiles.json")


def _default_ai_face_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "sbi_ffraw.pth")


def _default_ai_face_retinaface_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "retinaface_resnet50_2020-07-20.pth")


def _default_audio_verify_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "audio_detector_model.pkl")


def _default_web_phishing_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_rf_com.joblib")


def _default_web_phishing_scaler_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_scaler_entire.joblib")


def _default_web_phishing_feature_columns_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_feature_columns.json")


def _default_web_phishing_url_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_rf_url.joblib")


def _default_web_phishing_url_scaler_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_scaler_url.joblib")


def _default_web_phishing_url_feature_columns_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "chiphish_url_feature_columns.json")


def _default_video_ai_code_root() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "D3" / "code")


def _default_video_ai_runtime_root() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "D3" / "runtime")


def _default_video_deception_face_landmarker_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "mediapipe" / "face_landmarker_v2_with_blendshapes.task")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://postgres:123456@127.0.0.1:5432/antifraud"

    jwt_secret: str = "change-me-in-production-use-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    upload_root: str = Field(default_factory=_default_upload_root)
    max_upload_bytes: int = 50 * 1024 * 1024

    dashscope_api_key: str | None = None
    dashscope_workspace: str | None = None
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    aliyun_asr_ws_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
    aliyun_asr_model: str = "fun-asr-realtime"
    aliyun_asr_format: str = "pcm"
    aliyun_asr_sample_rate: int = 16000
    aliyun_asr_semantic_punctuation_enabled: bool = False
    aliyun_asr_max_sentence_silence: int | None = None
    audio_linear_enable: bool = True
    audio_linear_model_path: str = Field(default_factory=_default_audio_linear_model_path)
    phone_risk_prefix_profile_path: str = Field(default_factory=_default_phone_risk_prefix_profile_path)
    audio_linear_window_seconds: float = 3.0
    audio_linear_eval_chunk_interval: int = 3
    audio_linear_min_positive_streak: int = 2
    audio_linear_cooldown_seconds: float = 8.0

    rag_text_chunk_soft_limit: int = 320
    rag_text_chunk_hard_limit: int = 640
    rag_text_chunk_overlap: int = 80
    rag_source_batch_size: int = 64
    rag_embedding_batch_size: int = 32
    rag_worker_poll_seconds: int = 5
    rag_embedding_provider: str = "hash"
    rag_embedding_model: str = "hash-1024"
    rag_embedding_dimensions: int = 1024
    rag_embedding_api_url: str = "https://api.openai.com/v1/embeddings"
    rag_embedding_api_key: str | None = None
    rag_embedding_timeout_seconds: int = 60
    agent_enabled: bool = True
    agent_model: str = "qwen-plus"
    agent_max_iterations: int = 10
    agent_text_rag_min_chars: int = 24
    vision_planner_max_images: int = 3
    vlm_model: str = "qwen-vl-plus"
    ocr_provider: str = "stub"
    baidu_ocr_api_key: str | None = None
    baidu_ocr_secret_key: str | None = None
    baidu_ocr_timeout_seconds: int = 20
    baidu_ocr_language_type: str = "CHN_ENG"
    baidu_ocr_detect_direction: bool = True
    baidu_ocr_vertexes_location: bool = True
    baidu_ocr_paragraph: bool = True
    baidu_ocr_probability: bool = True
    baidu_ocr_recognize_granularity: str = "big"
    baidu_ocr_char_probability: bool = False
    baidu_ocr_eng_granularity: str = "word"
    baidu_ocr_multidirectional_recognize: bool = True
    reverse_image_provider: str = "baidu"
    reverse_image_timeout_seconds: int = 20
    reverse_image_browser_timeout_ms: int = 45000
    reverse_image_browser_headless: bool = True
    reverse_image_browser_keep_open: bool = False
    reverse_image_browser_executable_path: str | None = None
    threatbook_lookup_enabled: bool = True
    threatbook_lookup_timeout_ms: int = 45000
    threatbook_lookup_headless: bool = True
    threatbook_lookup_keep_open: bool = False
    threatbook_lookup_executable_path: str | None = None
    threatbook_storage_state_path: str = Field(default_factory=_default_threatbook_storage_state_path)
    image_similarity_candidate_limit: int = 6
    image_similarity_download_timeout_seconds: int = 15
    image_similarity_download_max_bytes: int = 8 * 1024 * 1024
    image_similarity_phash_distance_threshold: int = 10
    image_similarity_dhash_distance_threshold: int = 12
    image_similarity_clip_enabled: bool = True
    image_similarity_clip_model: str = "openai/clip-vit-large-patch14"
    image_similarity_clip_device: str = "auto"
    image_similarity_clip_medium_threshold: float = 0.86
    image_similarity_clip_high_threshold: float = 0.92
    agent_timeout_seconds: int = 60

    detection_worker_poll_seconds: int = 5
    detection_background_on_submit: bool = True
    detection_llm_provider: str = "openai_compatible"
    detection_llm_model: str = "qwen3.5-flash"
    detection_llm_api_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    detection_llm_api_key: str | None = None
    detection_llm_timeout_seconds: int = 120
    detection_llm_temperature: float = 0.15
    detection_llm_max_tokens: int = 900
    detection_llm_enable_thinking: bool = False
    detection_llm_use_structured_outputs: bool = True
    detection_retrieval_vector_top_k: int = 6
    detection_retrieval_keyword_top_k: int = 6
    detection_retrieval_black_top_k: int = 5
    detection_retrieval_white_top_k: int = 3
    detection_retrieval_hybrid_bonus: float = 0.1
    detection_fusion_rule_weight: float = 0.34
    detection_fusion_retrieval_weight: float = 0.33
    detection_fusion_llm_weight: float = 0.33
    detection_low_risk_threshold: int = 24
    detection_high_risk_threshold: int = 55
    detection_manual_review_confidence_threshold: float = 0.62
    detection_prompt_text_limit: int = 1800
    detection_history_limit_default: int = 20
    detection_history_limit_max: int = 100
    detection_text_storage_limit: int = 20000
    audio_scam_insight_model: str = "qwen3.5-omni-plus"
    audio_scam_insight_base_url: str | None = None
    audio_scam_insight_api_key: str | None = None
    audio_scam_insight_timeout_seconds: int = 180
    audio_scam_insight_temperature: float = 0.1
    audio_scam_insight_max_tokens: int = 2200
    audio_scam_insight_max_file_bytes: int = 9_500_000
    audio_scam_insight_language_hint: str = "zh"
    image_fraud_reference_dir: str = Field(default_factory=_default_image_fraud_reference_dir)
    image_fraud_cache_path: str = Field(default_factory=_default_image_fraud_cache_path)
    image_fraud_reference_limit: int = 0
    image_fraud_top_k: int = 5
    image_fraud_positive_floor: float = 0.74
    image_fraud_review_floor: float = 0.67
    ai_face_detector_backend: str = "local_sbi_multiface"
    ai_face_local_model_path: str = Field(default_factory=_default_ai_face_model_path)
    ai_face_retinaface_model_path: str = Field(default_factory=_default_ai_face_retinaface_model_path)
    ai_face_device: str = "auto"
    ai_face_fake_threshold: float = 0.5
    ai_face_face_confidence_threshold: float = 0.7
    ai_face_face_nms_threshold: float = 0.4
    ai_face_retinaface_max_size: int = 4096
    audio_verify_model_path: str = Field(default_factory=_default_audio_verify_model_path)
    video_ai_detector_enabled: bool = True
    video_ai_code_root: str = Field(default_factory=_default_video_ai_code_root)
    video_ai_runtime_root: str = Field(default_factory=_default_video_ai_runtime_root)
    video_ai_encoder: str = "XCLIP-16"
    video_ai_loss: str = "l2"
    video_ai_device: str = "auto"
    video_ai_timeout_seconds: int = 300
    video_ai_keep_frames: bool = False
    video_ai_generate_explanation: bool = True
    video_ai_std_low_threshold: float = 1.5
    video_ai_std_normal_upper: float = 3.5
    video_ai_std_high_threshold: float = 5.0
    video_deception_enabled: bool = True
    video_deception_face_landmarker_path: str = Field(default_factory=_default_video_deception_face_landmarker_path)
    video_deception_target_fps: float = 10.0
    video_deception_max_duration_seconds: int = 60
    video_deception_min_face_frames: int = 24
    video_deception_hr_low_hz: float = 0.7
    video_deception_hr_high_hz: float = 3.0
    video_deception_hr_window_seconds: float = 8.0
    video_deception_hr_stride_seconds: float = 1.5
    video_deception_medium_threshold: float = 0.42
    video_deception_high_threshold: float = 0.68
    web_phishing_model_path: str = Field(default_factory=_default_web_phishing_model_path)
    web_phishing_scaler_path: str = Field(default_factory=_default_web_phishing_scaler_path)
    web_phishing_feature_columns_path: str = Field(default_factory=_default_web_phishing_feature_columns_path)
    web_phishing_url_model_path: str = Field(default_factory=_default_web_phishing_url_model_path)
    web_phishing_url_scaler_path: str = Field(default_factory=_default_web_phishing_url_scaler_path)
    web_phishing_url_feature_columns_path: str = Field(default_factory=_default_web_phishing_url_feature_columns_path)
    user_profile_default_safety_score: int = 95
    user_profile_memory_urgency_threshold: int = 70
    user_profile_recent_result_limit: int = 5
    user_profile_summary_max_length: int = 220
    user_memory_root: str = Field(default_factory=_default_user_memory_root)
    user_memory_recent_assistant_limit: int = 12
    user_memory_long_term_entry_limit: int = 24
    user_memory_prompt_entry_limit: int = 6
    user_memory_promotion_score_threshold: float = 0.8
    user_memory_promotion_min_recall_count: int = 2
    user_memory_promotion_min_unique_queries: int = 2
    user_memory_recency_half_life_days: int = 14
    user_memory_max_age_days: int = 30

    assistant_llm_provider: str = "openai_compatible"
    assistant_llm_model: str = "qwen3-vl-flash"
    assistant_llm_api_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    assistant_llm_api_key: str | None = None
    assistant_llm_timeout_seconds: int = 90
    assistant_llm_temperature: float = 0.2
    assistant_llm_max_tokens: int = 700
    assistant_llm_enable_thinking: bool = False
    assistant_context_max_messages: int = 12
    assistant_relation_memory_limit: int = 4
    expo_push_enabled: bool = True
    expo_push_api_url: str = "https://exp.host/--/api/v2/push/send"
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "lyn-agent"
    langsmith_endpoint: str | None = None
    langsmith_workspace_id: str | None = None


settings = Settings()
