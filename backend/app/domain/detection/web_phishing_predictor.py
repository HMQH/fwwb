from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.domain.detection.web_phishing_features import (
    FEATURE_COLUMNS,
    URL_FEATURE_COLUMNS,
    extract_feature_dict,
    extract_feature_frame_for_model,
    extract_url_feature_dict,
    extract_url_feature_frame_for_model,
    normalize_url,
)
from app.shared.core.config import settings


def _artifact_path(raw_path: str) -> Path:
    return Path(raw_path).expanduser().resolve()


@lru_cache(maxsize=1)
def load_url_html_artifacts() -> tuple[Any, Any, list[str]]:
    model = joblib.load(_artifact_path(settings.web_phishing_model_path))
    scaler = joblib.load(_artifact_path(settings.web_phishing_scaler_path))
    feature_columns = json.loads(
        _artifact_path(settings.web_phishing_feature_columns_path).read_text(encoding="utf-8")
    )
    return model, scaler, feature_columns


@lru_cache(maxsize=1)
def load_url_only_artifacts() -> tuple[Any, Any, list[str]]:
    model = joblib.load(_artifact_path(settings.web_phishing_url_model_path))
    scaler = joblib.load(_artifact_path(settings.web_phishing_url_scaler_path))
    feature_columns = json.loads(
        _artifact_path(settings.web_phishing_url_feature_columns_path).read_text(encoding="utf-8")
    )
    return model, scaler, feature_columns


def _prepare_feature_frame(feature_df: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    missing = [column for column in feature_columns if column not in feature_df.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")
    return feature_df[feature_columns].apply(pd.to_numeric, errors="coerce").fillna(0.0).astype(float)


def _risk_level(prob: float, pred_label: int) -> str:
    if int(pred_label) == 0:
        return "safe"
    if prob >= 0.85:
        return "high"
    if prob >= 0.60:
        return "medium"
    if prob >= 0.50:
        return "suspicious"
    return "safe"


def _build_response(
    *,
    url: str,
    mode: str,
    model_name: str,
    pred_label: Any,
    phish_prob: Any,
    features: dict[str, Any] | None = None,
) -> dict[str, Any]:
    probability = float(phish_prob)
    label = int(pred_label)
    return {
        "url": url,
        "mode": mode,
        "model_name": model_name,
        "pred_label": label,
        "is_phishing": bool(label == 1),
        "phish_prob": probability,
        "confidence": probability,
        "risk_level": _risk_level(probability, label),
        "features": features,
    }


def predict_from_url_html(url: str, html: str, *, return_features: bool = False) -> dict[str, Any]:
    normalized_url = normalize_url(url)
    feature_df = extract_feature_frame_for_model(normalized_url, html)
    model, scaler, feature_columns = load_url_html_artifacts()
    x = _prepare_feature_frame(feature_df, feature_columns)
    x_scaled = scaler.transform(x)
    pred_label = model.predict(x_scaled)[0]
    phish_prob = model.predict_proba(x_scaled)[0, 1]
    feature_payload = None
    if return_features:
        raw_features = extract_feature_dict(normalized_url, html)
        feature_payload = {key: float(raw_features[key]) for key in FEATURE_COLUMNS}
    return _build_response(
        url=normalized_url,
        mode="url_html",
        model_name="chiphish_rf_com",
        pred_label=pred_label,
        phish_prob=phish_prob,
        features=feature_payload,
    )


def predict_from_url_only(url: str, *, return_features: bool = False) -> dict[str, Any]:
    normalized_url = normalize_url(url)
    feature_df = extract_url_feature_frame_for_model(normalized_url)
    model, scaler, feature_columns = load_url_only_artifacts()
    x = _prepare_feature_frame(feature_df, feature_columns)
    x_scaled = scaler.transform(x)
    pred_label = model.predict(x_scaled)[0]
    phish_prob = model.predict_proba(x_scaled)[0, 1]
    feature_payload = None
    if return_features:
        raw_features = extract_url_feature_dict(normalized_url)
        feature_payload = {key: float(raw_features[key]) for key in URL_FEATURE_COLUMNS}
    return _build_response(
        url=normalized_url,
        mode="url_only",
        model_name="chiphish_rf_url",
        pred_label=pred_label,
        phish_prob=phish_prob,
        features=feature_payload,
    )


def predict_web_phishing(url: str, html: str | None = None, *, return_features: bool = False) -> dict[str, Any]:
    if not str(url or "").strip():
        raise ValueError("url 不能为空")
    if html and str(html).strip():
        return predict_from_url_html(url, html, return_features=return_features)
    return predict_from_url_only(url, return_features=return_features)
