"""从环境变量 / .env 读取配置。"""
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_upload_root() -> str:
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "uploads")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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
    detection_low_risk_threshold: int = 24
    detection_high_risk_threshold: int = 55
    detection_manual_review_confidence_threshold: float = 0.62
    detection_prompt_text_limit: int = 1800
    detection_history_limit_default: int = 20
    detection_history_limit_max: int = 100
    detection_text_storage_limit: int = 20000


settings = Settings()
