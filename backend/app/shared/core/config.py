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


def _default_ai_face_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "sbi_ffraw.pth")


def _default_ai_face_retinaface_model_path() -> str:
    return str(_BACKEND_ROOT / "checkpoints" / "retinaface_resnet50_2020-07-20.pth")


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
    ai_face_detector_backend: str = "local_sbi_multiface"
    ai_face_local_model_path: str = Field(default_factory=_default_ai_face_model_path)
    ai_face_retinaface_model_path: str = Field(default_factory=_default_ai_face_retinaface_model_path)
    ai_face_device: str = "auto"
    ai_face_fake_threshold: float = 0.5
    ai_face_face_confidence_threshold: float = 0.7
    ai_face_face_nms_threshold: float = 0.4
    ai_face_retinaface_max_size: int = 4096
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


settings = Settings()
