"""通话干预业务服务。"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import uuid
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException, WebSocket, status
from sqlalchemy.orm import Session

from app.domain.call_intervention.ml import AudioFraudDecision, OnlineAudioFraudJudge, create_online_audio_fraud_judge
from app.domain.call_intervention import repository
from app.domain.uploads import service as upload_service
from app.domain.call_intervention.entity import (
    CallAsrSegment,
    CallRiskEvent,
    CallSession,
    PhoneRiskProfile,
)
from app.shared.core.config import settings
from app.shared.schemas.call_intervention import (
    CallAsrSegmentResponse,
    CallSessionDetailResponse,
    CallSessionResponse,
    CallSessionStartRequest,
    CallSessionStopRequest,
    CallRiskEventResponse,
    PhoneRiskLookupResponse,
    RiskEvaluateTextResponse,
    RiskRuleHit,
)
from app.shared.storage.object_store import save_call_recording_file
from app.shared.storage.upload_paths import resolved_upload_root

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None

SAFE_ACCOUNT_RE = re.compile(r"(安全账户|安全帐户|资金核查|转到.*安全.*账户)")
VERIFY_CODE_RE = re.compile(r"(验证码|短信码|校验码)")
SCREEN_SHARE_RE = re.compile(r"(共享屏幕|远程控制|下载.{0,8}(会议|软件|APP)|屏幕共享)")
AUTHORITY_RE = re.compile(r"(公安|警察|银行|银保监会|检察院|客服)")
TRANSFER_RE = re.compile(r"(转账|汇款|刷流水|先打款|解冻)")


@dataclass(frozen=True)
class RuleDefinition:
    code: str
    risk_level: str
    message: str
    matcher: re.Pattern[str]


@dataclass(frozen=True)
class PrefixRiskSeed:
    prefix: str
    score: int
    labels: list[str]
    source: str
    suggestion: str | None = None


RULES = [
    RuleDefinition(
        code="safe_account_transfer",
        risk_level="high",
        message="检测到“安全账户/资金核查”话术，建议立即挂断。",
        matcher=SAFE_ACCOUNT_RE,
    ),
    RuleDefinition(
        code="verify_code_request",
        risk_level="high",
        message="检测到索要验证码，请勿透露任何短信验证码。",
        matcher=VERIFY_CODE_RE,
    ),
    RuleDefinition(
        code="remote_screen_share",
        risk_level="high",
        message="检测到远程控制或共享屏幕要求，风险极高。",
        matcher=SCREEN_SHARE_RE,
    ),
    RuleDefinition(
        code="authority_plus_transfer",
        risk_level="medium",
        message="检测到冒充公检法或银行并要求资金操作，请立即核验身份。",
        matcher=re.compile(r"(公安|警察|银行|客服).{0,24}(转账|汇款|安全账户|解冻)"),
    ),
]

AI_RISK_RULE_CODES = {
    "medium": "AI中风险判定",
    "high": "AI高风险判定",
}
AI_CONTEXT_SEGMENT_LIMIT = 6
AI_CONTEXT_CHAR_LIMIT = 240
AI_MIN_CONTEXT_CHARS = 12
AI_EVAL_COOLDOWN_SECONDS = 4.0
RETRANSCRIBE_MAX_DURATION_MS = 10 * 60 * 1000
MANUAL_UNKNOWN_PHONE = "manual_unknown"


@dataclass(frozen=True)
class AiTranscriptRiskEvaluation:
    risk_level: str
    reason: str
    signals: list[str]
    action: str
    confidence: float | None
    model_name: str | None = None


def _normalize_phone(phone_number: str) -> str:
    return re.sub(r"[^\d+]", "", phone_number.strip())


def _resolve_settings_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


@lru_cache(maxsize=1)
def _load_prefix_risk_seeds() -> list[PrefixRiskSeed]:
    path = _resolve_settings_path(settings.phone_risk_prefix_profile_path)
    if not path.exists():
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []

    rows: list[PrefixRiskSeed] = []
    if not isinstance(payload, list):
        return rows

    for item in payload:
        if not isinstance(item, dict):
            continue
        prefix = str(item.get("prefix") or "").strip()
        if not prefix:
            continue
        score = int(item.get("score") or 0)
        labels = [str(label).strip() for label in (item.get("labels") or []) if str(label).strip()]
        source = str(item.get("source") or "seed")
        suggestion = str(item.get("suggestion")).strip() if item.get("suggestion") else None
        rows.append(
            PrefixRiskSeed(
                prefix=prefix,
                score=max(0, min(100, score)),
                labels=labels,
                source=source,
                suggestion=suggestion,
            )
        )

    rows.sort(key=lambda item: len(item.prefix), reverse=True)
    return rows


def _risk_rank(level: str) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(level, 1)


def _max_risk(a: str, b: str) -> str:
    return a if _risk_rank(a) >= _risk_rank(b) else b


def _normalize_ai_risk_level(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"low", "medium", "high"} else "low"


def _normalize_ai_signals(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    signals: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text or text in signals:
            continue
        signals.append(text[:18])
        if len(signals) >= 3:
            break
    return signals


def _normalize_ai_confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if score < 0:
        return 0.0
    if score > 1:
        return 1.0
    return score


def _trim_ai_text(value: Any, *, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _build_ai_context(recent_segments: list[dict[str, Any]]) -> str:
    rows: list[str] = []
    for item in recent_segments[-AI_CONTEXT_SEGMENT_LIMIT:]:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        seq = int(item.get("seq") or 0)
        rows.append(f"{seq}. {text}" if seq > 0 else text)

    if not rows:
        return ""

    context = "\n".join(rows)
    if len(context) <= AI_CONTEXT_CHAR_LIMIT:
        return context
    return context[-AI_CONTEXT_CHAR_LIMIT:]


def _ai_message(level: str, reason: str, action: str) -> str:
    prefix = "AI判定高风险" if level == "high" else "AI判定中风险" if level == "medium" else "AI判定低风险"
    detail = reason or ("存在明显诈骗特征" if level == "high" else "存在可疑诱导话术" if level == "medium" else "暂未发现明显诈骗话术")
    action_text = action.strip("。；，,. ") if action else ""
    if action_text:
        return f"{prefix}：{detail}，建议{action_text}。"
    return f"{prefix}：{detail}。"


def should_emit_ai_risk(*, ai_risk_level: str, rule_risk_level: str) -> bool:
    if ai_risk_level not in {"medium", "high"}:
        return False
    return _risk_rank(ai_risk_level) > _risk_rank(rule_risk_level)


def _display_phone_label(phone_number: str | None) -> str:
    normalized = str(phone_number or "").strip()
    if not normalized or normalized == MANUAL_UNKNOWN_PHONE:
        return "未知号码"
    return normalized


def _split_text_sentences(text: str) -> list[str]:
    rows = re.split(r"[\n。！？!?；;，,]+", text)
    return [item.strip() for item in rows if item and item.strip()]


def _truncate_title(text: str, *, limit: int = 18) -> str:
    normalized = re.sub(r"\s+", "", text).strip("：:，,。；; ")
    if not normalized:
        return ""
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit]


def _fallback_session_title(*, transcript_text: str, risk_level: str, phone_number: str | None) -> str:
    normalized = transcript_text.strip()
    if SAFE_ACCOUNT_RE.search(normalized):
        return "通话诱导转安全账户"
    if VERIFY_CODE_RE.search(normalized):
        return "通话中索要验证码"
    if SCREEN_SHARE_RE.search(normalized):
        return "通话要求远程控制"
    if AUTHORITY_RE.search(normalized) and TRANSFER_RE.search(normalized):
        return "冒充权威要求转账"

    for sentence in _split_text_sentences(normalized):
        title = _truncate_title(sentence)
        if len(title) >= 6:
            return title

    phone_label = _display_phone_label(phone_number)
    if risk_level == "high":
        return f"{phone_label}高风险通话"
    if risk_level == "medium":
        return f"{phone_label}可疑通话"
    return f"{phone_label}通话录音"


def generate_session_title(*, transcript_text: str, risk_level: str, phone_number: str | None) -> str:
    normalized = transcript_text.strip()
    if not normalized:
        return _fallback_session_title(transcript_text="", risk_level=risk_level, phone_number=phone_number)

    try:
        from app.domain.detection.llm import build_chat_json_client

        client = build_chat_json_client()
        result = client.complete_json(
            system_prompt=(
                "你是通话记录标题生成器。"
                "只根据给定转写生成一个简短标题。"
                "必须只输出 JSON，不要输出其他内容。"
            ),
            user_prompt=(
                "请为这段通话生成一个中文标题。\n"
                f"风险等级：{risk_level}\n"
                f"号码：{_display_phone_label(phone_number)}\n"
                f"转写：{normalized[:220]}\n\n"
                "按以下 JSON 返回：\n"
                "{\n"
                '  "title": "不超过18个汉字"\n'
                "}"
            ),
        )
        payload = result.payload if isinstance(result.payload, dict) else {}
        title = _truncate_title(payload.get("title"))
        if title:
            return title
    except Exception:  # noqa: BLE001
        pass

    return _fallback_session_title(
        transcript_text=normalized,
        risk_level=risk_level,
        phone_number=phone_number,
    )


def _resolve_recording_object_path(*, upload_root_cfg: str, object_key: str) -> Path:
    upload_root = resolved_upload_root(upload_root_cfg).resolve()
    target = (upload_root / object_key).resolve()
    try:
        target.relative_to(upload_root)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="录音文件路径非法") from exc
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="录音文件不存在")
    return target


def _read_wav_pcm(audio_path: Path) -> tuple[bytes, int, int, int]:
    try:
        with wave.open(str(audio_path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            frames = wav_file.getnframes()
            pcm = wav_file.readframes(frames)
    except wave.Error as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="录音文件不是合法 WAV") from exc

    if sample_width != 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 16bit PCM WAV 重新转写")
    if channels != 1 or sample_rate != settings.aliyun_asr_sample_rate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"仅支持 {settings.aliyun_asr_sample_rate}Hz 单声道 WAV 重新转写",
        )

    duration_ms = int(frames / float(sample_rate) * 1000)
    return pcm, sample_rate, channels, duration_ms


def _default_lookup(phone_number: str) -> PhoneRiskLookupResponse:
    score = 18
    labels: list[str] = []
    source = "system"

    if phone_number.startswith(("+86162", "+86165", "+86167", "+86170", "+86171", "162", "165", "167", "170", "171")):
        score = 82
        labels.extend(["高频营销号段", "虚拟运营商"])
        source = "heuristic"
    elif phone_number.startswith(("95", "+8695")):
        score = 66
        labels.extend(["客服号段", "需人工核验"])
        source = "heuristic"
    elif phone_number.startswith("400"):
        score = 60
        labels.extend(["客服外呼异常", "需人工核验"])
        source = "heuristic"
    elif phone_number.startswith(("+44", "+60", "+84", "+63")):
        score = 74
        labels.extend(["境外来电", "需核验"])
        source = "heuristic"

    risk_level = "high" if score >= 80 else "medium" if score >= 55 else "low"
    suggestion = {
        "high": "疑似诈骗来电，请勿透露验证码，建议立即开始录音取证。",
        "medium": "号码存在异常特征，请核验身份后再继续通话。",
        "low": "暂未命中高风险号码特征，仍请保持警惕。",
    }[risk_level]
    return PhoneRiskLookupResponse(
        phone_number=phone_number,
        risk_level=risk_level,
        score=score,
        labels=labels,
        suggestion=suggestion,
        source=source,
    )


def _lookup_prefix_seed(phone_number: str) -> PhoneRiskLookupResponse | None:
    for seed in _load_prefix_risk_seeds():
        if phone_number.startswith(seed.prefix):
            risk_level = "high" if seed.score >= 80 else "medium" if seed.score >= 55 else "low"
            suggestion = seed.suggestion or {
                "high": "命中高风险号码前缀画像，建议立即警惕并准备录音取证。",
                "medium": "命中中风险号码前缀画像，建议先核验身份再继续通话。",
                "low": "命中低风险号码画像，建议继续观察通话内容。",
            }[risk_level]
            return PhoneRiskLookupResponse(
                phone_number=phone_number,
                risk_level=risk_level,
                score=seed.score,
                labels=list(seed.labels),
                suggestion=suggestion,
                source=seed.source,
            )
    return None


def lookup_number(db: Session, *, phone_number: str) -> PhoneRiskLookupResponse:
    normalized = _normalize_phone(phone_number)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="号码不能为空")

    profile = repository.get_phone_risk_profile(db, normalized)

    if profile:
        risk_level = "high" if profile.score >= 80 else "medium" if profile.score >= 55 else "low"
        return PhoneRiskLookupResponse(
            phone_number=normalized,
            risk_level=risk_level,
            score=profile.score,
            labels=list(profile.labels or []),
            suggestion="命中历史风险画像，请提醒用户谨慎接听。",
            source=profile.source,
        )

    prefix_hit = _lookup_prefix_seed(normalized)
    if prefix_hit is not None:
        repository.save_phone_risk_profile(
            db,
            PhoneRiskProfile(
                phone_number=normalized,
                score=prefix_hit.score,
                labels=prefix_hit.labels,
                source=prefix_hit.source,
            ),
        )
        return prefix_hit

    fallback = _default_lookup(normalized)
    repository.save_phone_risk_profile(
        db,
        PhoneRiskProfile(
            phone_number=normalized,
            score=fallback.score,
            labels=fallback.labels,
            source=fallback.source,
        ),
    )
    return fallback


def start_session(
    db: Session,
    *,
    user_id: uuid.UUID,
    body: CallSessionStartRequest,
) -> CallSession:
    phone_number = _normalize_phone(body.phone_number) or MANUAL_UNKNOWN_PHONE
    row = CallSession(
        user_id=user_id,
        phone_number=phone_number,
        call_direction=body.call_direction,
        risk_level_initial=body.risk_level_initial,
        risk_level_final=body.risk_level_initial,
        risk_labels=body.risk_labels,
        recording_status="recording",
        transcript_status="streaming",
    )
    return repository.create_call_session(db, row)


def stop_session(
    db: Session,
    *,
    user_id: uuid.UUID,
    body: CallSessionStopRequest,
) -> CallSession:
    row = repository.get_call_session_by_id(db, session_id=body.session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")

    row.recording_status = "stopped"
    row.transcript_status = "completed" if (body.transcript_full_text or row.transcript_full_text) else "pending"
    row.ended_at = datetime.now(timezone.utc)
    if body.risk_level_final:
        row.risk_level_final = body.risk_level_final
    if body.transcript_full_text:
        row.transcript_full_text = body.transcript_full_text
    if body.summary:
        row.summary = body.summary
    elif row.transcript_full_text:
        row.summary = generate_session_title(
            transcript_text=row.transcript_full_text,
            risk_level=row.risk_level_final,
            phone_number=row.phone_number,
        )
    elif not row.summary:
        row.summary = _fallback_session_title(
            transcript_text="",
            risk_level=row.risk_level_final,
            phone_number=row.phone_number,
        )
    if body.audio_duration_ms is not None:
        row.audio_duration_ms = body.audio_duration_ms
    if body.audio_file_url:
        row.audio_file_url = body.audio_file_url
    if body.audio_object_key:
        row.audio_object_key = body.audio_object_key
    return repository.save_call_session(db, row)


def save_recording_upload(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    upload_root_cfg: str,
    source_path: Path,
) -> CallSession:
    row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")

    url, object_key = save_call_recording_file(
        upload_root_cfg=upload_root_cfg,
        session_id=session_id,
        user_id=user_id,
        source_file=source_path,
    )
    row.audio_file_url = url
    row.audio_object_key = object_key
    object_parts = Path(object_key).parts
    storage_batch_id = object_parts[1] if len(object_parts) >= 4 else session_id.hex
    upload_service.sync_upload_bundle(
        db,
        user_id=user_id,
        storage_batch_id=storage_batch_id,
        text_paths=[],
        audio_paths=[object_key],
        image_paths=[],
        video_paths=[],
        source_submission_id=None,
    )
    return repository.save_call_session(db, row)


def append_asr_segment(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    seq: int,
    start_ms: int,
    end_ms: int,
    text: str,
    confidence: float | None,
    is_final: bool,
) -> CallAsrSegment:
    session_row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if session_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")

    segment = CallAsrSegment(
        session_id=session_id,
        seq=seq,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        confidence=confidence,
        is_final=is_final,
    )
    repository.create_asr_segment(db, segment)

    existing = (session_row.transcript_full_text or "").strip()
    session_row.transcript_full_text = f"{existing}\n{text}".strip() if existing else text
    session_row.transcript_status = "streaming"
    repository.save_call_session(db, session_row)
    return segment


def evaluate_text(*, text: str) -> RiskEvaluateTextResponse:
    normalized = text.strip()
    if not normalized:
        return RiskEvaluateTextResponse(risk_level="low", score_delta=0, hits=[])

    hits: list[RiskRuleHit] = []
    risk_level = "low"
    score_delta = 0

    for rule in RULES:
        if rule.matcher.search(normalized):
            hits.append(
                RiskRuleHit(
                    rule_code=rule.code,
                    risk_level=rule.risk_level,
                    message=rule.message,
                )
            )
            risk_level = _max_risk(risk_level, rule.risk_level)
            score_delta += 30 if rule.risk_level == "high" else 18

    if AUTHORITY_RE.search(normalized) and TRANSFER_RE.search(normalized):
        hits.append(
            RiskRuleHit(
                rule_code="authority_transfer_combo",
                risk_level="high",
                message="检测到“权威身份 + 转账操作”组合，请立即挂断并核验。",
            )
        )
        risk_level = "high"
        score_delta += 36

    return RiskEvaluateTextResponse(risk_level=risk_level, score_delta=score_delta, hits=hits)


def evaluate_transcript_with_ai(
    *,
    phone_number: str,
    risk_level_initial: str,
    recent_segments: list[dict[str, Any]],
) -> AiTranscriptRiskEvaluation | None:
    context = _build_ai_context(recent_segments)
    if len(re.sub(r"\s+", "", context)) < AI_MIN_CONTEXT_CHARS:
        return None

    try:
        from app.domain.detection.llm import build_chat_json_client

        client = build_chat_json_client()
    except Exception:  # noqa: BLE001
        return None

    system_prompt = (
        "你是通话反诈风控引擎。"
        "只根据给定的最近通话转写判断风险，不要臆测未出现的事实。"
        "高风险：明确出现安全账户、验证码、转账汇款、远程控制、下载 APP、冒充公检法/银行客服施压、保密要求等。"
        "中风险：身份可疑、诱导核验资金、索要个人信息、强催操作，但证据还没到高风险。"
        "低风险：内容正常或证据不足。"
        "必须只返回 JSON 对象，不要输出任何额外文字。"
    )
    user_prompt = (
        "请分析下面最近通话转写。\n"
        f"号码：{phone_number or '未知'}\n"
        f"初始号码风险：{risk_level_initial or 'low'}\n"
        "最近转写：\n"
        f"{context}\n\n"
        "按以下 JSON 返回：\n"
        "{\n"
        '  "risk_level": "low|medium|high",\n'
        '  "reason": "一句中文结论，18字内",\n'
        '  "signals": ["最多3个短语"],\n'
        '  "action": "一句短建议",\n'
        '  "confidence": 0.0\n'
        "}"
    )

    try:
        result = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
    except Exception:  # noqa: BLE001
        return None

    payload = result.payload if isinstance(result.payload, dict) else {}
    risk_level = _normalize_ai_risk_level(payload.get("risk_level"))
    signals = _normalize_ai_signals(payload.get("signals"))
    reason = _trim_ai_text(payload.get("reason"), limit=24)
    if not reason and signals:
        reason = "，".join(signals[:2])[:24]
    action = _trim_ai_text(payload.get("action"), limit=18)

    return AiTranscriptRiskEvaluation(
        risk_level=risk_level,
        reason=reason,
        signals=signals,
        action=action,
        confidence=_normalize_ai_confidence(payload.get("confidence")),
        model_name=result.model_name,
    )


def ai_evaluation_to_hit(evaluation: AiTranscriptRiskEvaluation) -> RiskRuleHit | None:
    if evaluation.risk_level not in AI_RISK_RULE_CODES:
        return None

    return RiskRuleHit(
        rule_code=AI_RISK_RULE_CODES[evaluation.risk_level],
        risk_level=evaluation.risk_level,
        message=_ai_message(evaluation.risk_level, evaluation.reason, evaluation.action),
    )


def build_ai_risk_payload(
    evaluation: AiTranscriptRiskEvaluation,
    *,
    segment_seq: int,
    text: str,
) -> dict[str, Any]:
    return {
        "source": "semantic_llm",
        "segment_seq": segment_seq,
        "text": text[:120],
        "reason": evaluation.reason,
        "signals": evaluation.signals,
        "action": evaluation.action,
        "confidence": evaluation.confidence,
        "model": evaluation.model_name,
    }


def create_audio_fraud_judge() -> OnlineAudioFraudJudge | None:
    return create_online_audio_fraud_judge()


def audio_decision_to_hit(decision: AudioFraudDecision) -> RiskRuleHit:
    return RiskRuleHit(
        rule_code=decision.rule_code,
        risk_level="high",
        message=decision.message,
    )


def persist_new_risk_hits(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    hits: list[RiskRuleHit],
    payload: dict | None = None,
) -> list[CallRiskEvent]:
    session_row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if session_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")

    created: list[CallRiskEvent] = []
    next_risk = session_row.risk_level_final

    for hit in hits:
        if repository.has_rule_hit(db, session_id=session_id, matched_rule=hit.rule_code):
            continue
        row = CallRiskEvent(
            session_id=session_id,
            event_type="rule_hit",
            risk_level=hit.risk_level,
            matched_rule=hit.rule_code,
            message=hit.message,
            payload=payload,
        )
        created.append(repository.create_risk_event(db, row))
        next_risk = _max_risk(next_risk, hit.risk_level)

    if created:
        session_row.risk_level_final = next_risk
        repository.save_call_session(db, session_row)

    return created


def persist_ai_risk_evaluation(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    evaluation: AiTranscriptRiskEvaluation,
    payload: dict[str, Any] | None = None,
) -> list[CallRiskEvent]:
    if evaluation.risk_level not in AI_RISK_RULE_CODES:
        return []

    if (
        evaluation.risk_level == "medium"
        and repository.has_rule_hit(db, session_id=session_id, matched_rule=AI_RISK_RULE_CODES["high"])
    ):
        return []

    hit = ai_evaluation_to_hit(evaluation)
    if hit is None:
        return []

    return persist_new_risk_hits(
        db,
        session_id=session_id,
        user_id=user_id,
        hits=[hit],
        payload=payload,
    )


async def _retranscribe_wav_file(audio_path: Path) -> tuple[list[dict[str, Any]], int]:
    if not settings.dashscope_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="当前环境未配置真实转写服务")

    pcm, sample_rate, _channels, duration_ms = _read_wav_pcm(audio_path)
    if duration_ms > RETRANSCRIBE_MAX_DURATION_MS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重新转写仅支持 10 分钟内的录音")

    asr = create_streaming_asr_session()
    segments: list[dict[str, Any]] = []

    async def collect_events(timeout: float) -> bool:
        finished = False
        for item in await asr.poll_events(timeout=timeout):
            item_type = str(item.get("type") or "")
            if item_type == "error":
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=str(item.get("message") or "重新转写失败"),
                )
            if item_type == "finished":
                finished = True
                continue
            if item_type != "sentence":
                continue

            text = str(item.get("text") or "").strip()
            if not text or not bool(item.get("sentence_end")):
                continue

            segments.append(
                {
                    "start_ms": int(item.get("start_ms") or 0),
                    "end_ms": int(item.get("end_ms") or 0),
                    "text": text,
                    "confidence": item.get("confidence") if isinstance(item.get("confidence"), float) else None,
                }
            )
        return finished

    try:
        await asr.connect()
        chunk_size = sample_rate * 2 // 5
        for offset in range(0, len(pcm), chunk_size):
            await asr.send_audio(pcm[offset : offset + chunk_size])
            await collect_events(0.01)
            await asyncio.sleep(0.005)

        await asr.finish()
        for _ in range(60):
            if await collect_events(0.2):
                break
    finally:
        try:
            await asr.close()
        except Exception:
            pass

    return segments, duration_ms


async def retranscribe_session(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> CallSessionDetailResponse:
    row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")
    if row.transcript_status in {"retranscribing", "retranscribed", "retranscribe_failed"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前通话仅允许重新转写一次")
    if not row.audio_object_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前通话没有可重转写的录音文件")

    audio_path = _resolve_recording_object_path(upload_root_cfg=settings.upload_root, object_key=row.audio_object_key)
    if not settings.dashscope_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="当前环境未配置真实转写服务")
    _pcm, _sample_rate, _channels, duration_ms = _read_wav_pcm(audio_path)
    if duration_ms > RETRANSCRIBE_MAX_DURATION_MS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重新转写仅支持 10 分钟内的录音")

    row.transcript_status = "retranscribing"
    repository.save_call_session(db, row)

    try:
        segments, duration_ms = await _retranscribe_wav_file(audio_path)
        if not segments:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="重新转写未识别到有效文本")

        repository.delete_asr_segments(db, session_id=session_id)
        row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")
        row.transcript_full_text = None
        row.audio_duration_ms = duration_ms
        repository.save_call_session(db, row)

        recent_segments: list[dict[str, Any]] = []
        for index, item in enumerate(segments, start=1):
            segment = append_asr_segment(
                db,
                session_id=session_id,
                user_id=user_id,
                seq=index,
                start_ms=int(item["start_ms"]),
                end_ms=int(item["end_ms"]),
                text=str(item["text"]),
                confidence=item.get("confidence") if isinstance(item.get("confidence"), float) else None,
                is_final=True,
            )
            recent_segments.append({"seq": segment.seq, "text": segment.text})
            if len(recent_segments) > AI_CONTEXT_SEGMENT_LIMIT:
                del recent_segments[:-AI_CONTEXT_SEGMENT_LIMIT]

            risk = evaluate_text(text=segment.text)
            persist_new_risk_hits(
                db,
                session_id=session_id,
                user_id=user_id,
                hits=risk.hits,
                payload={"segment_seq": segment.seq, "text": segment.text, "source": "retranscribe"},
            )

        ai_risk = evaluate_transcript_with_ai(
            phone_number=row.phone_number,
            risk_level_initial=row.risk_level_initial,
            recent_segments=recent_segments,
        )
        if ai_risk is not None and ai_risk.risk_level in {"medium", "high"}:
            persist_ai_risk_evaluation(
                db,
                session_id=session_id,
                user_id=user_id,
                evaluation=ai_risk,
                payload=build_ai_risk_payload(
                    ai_risk,
                    segment_seq=len(segments),
                    text=str(segments[-1]["text"]),
                ),
            )

        row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")
        row.transcript_status = "retranscribed"
        row.audio_duration_ms = duration_ms
        row.summary = generate_session_title(
            transcript_text=row.transcript_full_text or "",
            risk_level=row.risk_level_final,
            phone_number=row.phone_number,
        )
        repository.save_call_session(db, row)
    except HTTPException:
        row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
        if row is not None:
            row.transcript_status = "retranscribe_failed"
            repository.save_call_session(db, row)
        raise
    except Exception as exc:  # noqa: BLE001
        row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
        if row is not None:
            row.transcript_status = "retranscribe_failed"
            repository.save_call_session(db, row)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"重新转写失败：{exc}") from exc

    return get_session_detail(db, user_id=user_id, session_id=session_id)


def get_session_detail(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> CallSessionDetailResponse:
    row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")

    segments = repository.list_asr_segments(db, session_id=session_id)
    risk_events = repository.list_risk_events(db, session_id=session_id)
    payload = CallSessionResponse.model_validate(row).model_dump()
    return CallSessionDetailResponse(
        **payload,
        segments=[CallAsrSegmentResponse.model_validate(item) for item in segments],
        risk_events=[CallRiskEventResponse.model_validate(item) for item in risk_events],
    )


def list_session_details(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int = 20,
) -> list[CallSessionDetailResponse]:
    rows = repository.list_call_sessions(db, user_id=user_id, limit=limit)
    result: list[CallSessionDetailResponse] = []
    for row in rows:
        payload = CallSessionResponse.model_validate(row).model_dump()
        result.append(
            CallSessionDetailResponse(
                **payload,
                segments=[
                    CallAsrSegmentResponse.model_validate(item)
                    for item in repository.list_asr_segments(db, session_id=row.id)
                ],
                risk_events=[
                    CallRiskEventResponse.model_validate(item)
                    for item in repository.list_risk_events(db, session_id=row.id)
                ],
            )
        )
    return result


class BaseStreamingAsrSession:
    async def connect(self) -> None:
        raise NotImplementedError

    async def send_audio(self, audio_bytes: bytes) -> None:
        raise NotImplementedError

    async def finish(self) -> None:
        raise NotImplementedError

    async def poll_events(self, timeout: float = 0.0) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def close(self) -> None:
        raise NotImplementedError


class MockStreamingAsrSession(BaseStreamingAsrSession):
    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._seq = 0
        self._emitted_index = 0
        self._phrases = [
            "你好，这里是银行客服。",
            "你的账户存在异常，需要立即核查。",
            "为了验证资金安全，请转到安全账户。",
            "不要告诉别人，短信验证码马上会发给你。",
        ]

    async def connect(self) -> None:
        return None

    async def send_audio(self, audio_bytes: bytes) -> None:
        self._seq += 1
        if self._seq % 4 != 0 or self._emitted_index >= len(self._phrases):
            return
        text = self._phrases[self._emitted_index]
        self._emitted_index += 1
        await self._queue.put(
            {
                "type": "sentence",
                "text": text,
                "start_ms": (self._emitted_index - 1) * 3000,
                "end_ms": self._emitted_index * 3000,
                "sentence_end": True,
                "confidence": 0.86,
            }
        )

    async def finish(self) -> None:
        await self._queue.put({"type": "finished"})

    async def poll_events(self, timeout: float = 0.0) -> list[dict[str, Any]]:
        if timeout <= 0 and self._queue.empty():
            return []
        try:
            first = await asyncio.wait_for(self._queue.get(), timeout if timeout > 0 else 0.001)
        except asyncio.TimeoutError:
            return []
        events = [first]
        while not self._queue.empty():
            events.append(self._queue.get_nowait())
        return events

    async def close(self) -> None:
        return None


class AliyunRealtimeAsrSession(BaseStreamingAsrSession):
    def __init__(self) -> None:
        self.task_id = str(uuid.uuid4())
        self._socket = None
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._reader_task: asyncio.Task[Any] | None = None

    async def connect(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets 依赖缺失")
        if not settings.dashscope_api_key:
            raise RuntimeError("DashScope API Key 未配置")

        headers = {
            "Authorization": f"bearer {settings.dashscope_api_key}",
            "user-agent": "FraudInterventionBackend/0.1.0",
        }
        if settings.dashscope_workspace:
            headers["X-DashScope-WorkSpace"] = settings.dashscope_workspace

        self._socket = await websockets.connect(
            settings.aliyun_asr_ws_url,
            additional_headers=headers,
            max_size=8 * 1024 * 1024,
            ping_interval=20,
        )
        run_task = {
            "header": {
                "action": "run-task",
                "task_id": self.task_id,
                "streaming": "duplex",
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": settings.aliyun_asr_model,
                "parameters": {
                    "format": settings.aliyun_asr_format,
                    "sample_rate": settings.aliyun_asr_sample_rate,
                    "semantic_punctuation_enabled": settings.aliyun_asr_semantic_punctuation_enabled,
                },
                "input": {},
            },
        }
        if settings.aliyun_asr_max_sentence_silence is not None:
            run_task["payload"]["parameters"]["max_sentence_silence"] = settings.aliyun_asr_max_sentence_silence

        await self._socket.send(json.dumps(run_task, ensure_ascii=False))

        while True:
            raw = await self._socket.recv()
            if isinstance(raw, bytes):
                continue
            message = json.loads(raw)
            event = str(message.get("header", {}).get("event") or "")
            if event == "task-started":
                break
            if event == "task-failed":
                raise RuntimeError(message.get("header", {}).get("error_message") or "阿里云 ASR 任务启动失败")

        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _reader_loop(self) -> None:
        assert self._socket is not None
        try:
            while True:
                raw = await self._socket.recv()
                if isinstance(raw, bytes):
                    continue
                message = json.loads(raw)
                header = message.get("header", {})
                event = str(header.get("event") or "")

                if event == "result-generated":
                    sentence = message.get("payload", {}).get("output", {}).get("sentence", {}) or {}
                    text = str(sentence.get("text") or "").strip()
                    if not text or sentence.get("heartbeat") is True:
                        continue
                    await self._queue.put(
                        {
                            "type": "sentence",
                            "text": text,
                            "start_ms": int(sentence.get("begin_time") or 0),
                            "end_ms": int(sentence.get("end_time") or 0),
                            "sentence_end": bool(sentence.get("sentence_end")),
                            "confidence": None,
                        }
                    )
                    continue

                if event == "task-finished":
                    await self._queue.put({"type": "finished"})
                    return

                if event == "task-failed":
                    await self._queue.put(
                        {
                            "type": "error",
                            "message": header.get("error_message") or "阿里云 ASR 处理失败",
                        }
                    )
                    return
        except Exception as exc:  # noqa: BLE001
            await self._queue.put({"type": "error", "message": str(exc)})

    async def send_audio(self, audio_bytes: bytes) -> None:
        if self._socket is None:
            raise RuntimeError("ASR websocket 未连接")
        await self._socket.send(audio_bytes)

    async def finish(self) -> None:
        if self._socket is None:
            return
        await self._socket.send(
            json.dumps(
                {
                    "header": {
                        "action": "finish-task",
                        "task_id": self.task_id,
                        "streaming": "duplex",
                    },
                    "payload": {"input": {}},
                },
                ensure_ascii=False,
            )
        )

    async def poll_events(self, timeout: float = 0.0) -> list[dict[str, Any]]:
        if timeout <= 0 and self._queue.empty():
            return []
        try:
            first = await asyncio.wait_for(self._queue.get(), timeout if timeout > 0 else 0.001)
        except asyncio.TimeoutError:
            return []
        events = [first]
        while not self._queue.empty():
            events.append(self._queue.get_nowait())
        return events

    async def close(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None
        if self._socket is not None:
            await self._socket.close()
            self._socket = None


def create_streaming_asr_session() -> BaseStreamingAsrSession:
    if settings.dashscope_api_key:
        return AliyunRealtimeAsrSession()
    return MockStreamingAsrSession()


def decode_audio_chunk(chunk_base64: str) -> bytes:
    try:
        return base64.b64decode(chunk_base64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="音频 chunk 不是合法的 Base64") from exc


async def ensure_ws_session_access(
    db: Session,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    websocket: WebSocket,
) -> CallSession:
    row = repository.get_call_session_by_id(db, session_id=session_id, user_id=user_id)
    if row is None:
        await websocket.close(code=4404, reason="session not found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通话会话不存在")
    return row


def safe_local_file(file_uri: str) -> Path:
    raw = file_uri.replace("file://", "", 1).strip()
    path = Path(raw)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="录音文件不存在")
    return path


def safe_temp_file_name(filename: str | None) -> str:
    base = os.path.basename((filename or "recording.wav").strip()) or "recording.wav"
    return re.sub(r"[^A-Za-z0-9._-]", "_", base)
