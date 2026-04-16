"""FastAPI 入口：在 backend 目录下执行 uvicorn main:app --reload"""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes import ai_face as ai_face_routes
from app.api.routes import auth as auth_routes
from app.api.routes import assistant as assistant_routes
from app.api.routes import detections as detections_routes
from app.api.routes import profile_memory as profile_memory_routes
from app.api.routes import rag as rag_routes
from app.api.routes import relations as relations_routes
from app.api.routes import uploads as uploads_routes
from app.shared.core.config import settings
from app.shared.db.session import get_db
from app.shared.storage.upload_paths import resolved_upload_root

app = FastAPI(title="API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_face_routes.router)
app.include_router(auth_routes.router)
app.include_router(assistant_routes.router)
app.include_router(detections_routes.router)
app.include_router(profile_memory_routes.router)
app.include_router(rag_routes.router)
app.include_router(uploads_routes.router)
app.include_router(relations_routes.router)

upload_root = resolved_upload_root(settings.upload_root)
upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_root), name="uploads")


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
