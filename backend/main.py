"""FastAPI 入口：在 backend 目录下执行 uvicorn main:app --reload"""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes import auth as auth_routes
from app.shared.db.session import get_db

app = FastAPI(title="API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)


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
