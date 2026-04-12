"""从环境变量 / .env 读取配置。"""
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_upload_root() -> str:
    """仓库根目录下 storage/uploads（相对 backend 工作目录时可用 UPLOAD_ROOT 覆盖）。"""
    repo_root = Path(__file__).resolve().parents[4]
    return str(repo_root / "storage" / "uploads")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 在系统环境变量或 .env 里设置 DATABASE_URL
    # 示例：postgresql+psycopg://用户:密码@127.0.0.1:5432/库名
    database_url: str = "postgresql+psycopg://postgres:123456@127.0.0.1:5432/antifraud"

    # JWT（生产环境务必通过环境变量覆盖 jwt_secret）
    jwt_secret: str = "change-me-in-production-use-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 天，Demo 用

    # 本地上传根目录（相对路径则相对进程 cwd，一般为 backend/）
    upload_root: str = Field(default_factory=_default_upload_root)
    # 单个上传文件大小上限（字节）
    max_upload_bytes: int = 50 * 1024 * 1024


settings = Settings()
