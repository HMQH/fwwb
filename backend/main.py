"""FastAPI 入口：在 backend 目录下执行 uvicorn main:app --reload"""
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes import admin as admin_routes
from app.api.routes import ai_face as ai_face_routes
from app.api.routes import auth as auth_routes
from app.api.routes import assistant as assistant_routes
from app.api.routes import call_intervention as call_intervention_routes
from app.api.routes import cases as cases_routes
from app.api.routes import detections as detections_routes
from app.api.routes import guardians as guardians_routes
from app.api.routes import guardian_reports as guardian_reports_routes
from app.api.routes import home_watering as home_watering_routes
from app.api.routes import learning as learning_routes
from app.api.routes import profile_memory as profile_memory_routes
from app.api.routes import rag as rag_routes
from app.api.routes import relations as relations_routes
from app.api.routes import uploads as uploads_routes
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.storage.upload_paths import resolved_upload_root

app = FastAPI(title="API", version="0.1.0")


def _resolve_static_dir(raw_path: str) -> Path:
    directory = Path(raw_path).expanduser()
    if directory.is_absolute():
        return directory.resolve()
    return (Path(__file__).resolve().parent.parent / directory).resolve()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_routes.router)
app.include_router(ai_face_routes.router)
app.include_router(auth_routes.router)
app.include_router(assistant_routes.router)
app.include_router(call_intervention_routes.router)
app.include_router(cases_routes.router)
app.include_router(detections_routes.router)
app.include_router(guardians_routes.router)
app.include_router(guardian_reports_routes.router)
app.include_router(home_watering_routes.router)
app.include_router(learning_routes.router)
app.include_router(profile_memory_routes.router)
app.include_router(rag_routes.router)
app.include_router(uploads_routes.router)
app.include_router(relations_routes.router)

upload_root = resolved_upload_root(settings.upload_root)
upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_root), name="uploads")

reference_root = _resolve_static_dir(settings.image_fraud_reference_dir)
reference_root.mkdir(parents=True, exist_ok=True)
app.mount("/reference-images", StaticFiles(directory=reference_root), name="reference-images")

video_ai_outputs_root = _resolve_static_dir(str(Path(settings.video_ai_runtime_root) / "outputs"))
video_ai_outputs_root.mkdir(parents=True, exist_ok=True)
app.mount("/video-ai-outputs", StaticFiles(directory=video_ai_outputs_root), name="video-ai-outputs")


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict[str, str]:
    """连上 PostgreSQL 时返回 database: ok。"""
    db.execute(text("SELECT 1"))
    return {"database": "ok"}
