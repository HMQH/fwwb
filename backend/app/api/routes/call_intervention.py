"""来电预警与实时干预接口。"""
from __future__ import annotations

import asyncio
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.domain.call_intervention import service
from app.domain.user.entity import User
from app.shared.core.config import settings
from app.shared.core.security import parse_user_id_from_token
from app.shared.db.session import SessionLocal, get_db
from app.shared.schemas.call_intervention import (
    CallSessionDetailResponse,
    CallSessionResponse,
    CallSessionStartRequest,
    CallSessionStopRequest,
    PhoneRiskLookupRequest,
    PhoneRiskLookupResponse,
    RiskEvaluateTextRequest,
    RiskEvaluateTextResponse,
)

router = APIRouter(prefix="/api/call-intervention", tags=["call-intervention"])


@router.post("/risk/lookup-number", response_model=PhoneRiskLookupResponse)
def lookup_number(
    body: PhoneRiskLookupRequest,
    db: Session = Depends(get_db),
) -> PhoneRiskLookupResponse:
    return service.lookup_number(db, phone_number=body.phone_number)


@router.post("/risk/evaluate-text", response_model=RiskEvaluateTextResponse)
def evaluate_text(
    body: RiskEvaluateTextRequest,
    current: User = Depends(get_current_user),
) -> RiskEvaluateTextResponse:
    return service.evaluate_text(text=body.text)


@router.post("/sessions/start", response_model=CallSessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(
    body: CallSessionStartRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> CallSessionResponse:
    row = service.start_session(db, user_id=current.id, body=body)
    return CallSessionResponse.model_validate(row)


@router.post("/sessions/stop", response_model=CallSessionResponse)
def stop_session(
    body: CallSessionStopRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> CallSessionResponse:
    row = service.stop_session(db, user_id=current.id, body=body)
    return CallSessionResponse.model_validate(row)


@router.post("/sessions/{session_id}/recording", response_model=CallSessionResponse)
async def upload_session_recording(
    session_id: uuid.UUID,
    audio_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> CallSessionResponse:
    suffix = Path(audio_file.filename or "recording.wav").suffix or ".wav"
    written = 0
    tmp_path: Path | None = None
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)
        # Stream to disk instead of reading the entire file into memory.
        while True:
            chunk = await audio_file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > settings.max_upload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"录音文件过大，超过 {settings.max_upload_bytes} 字节",
                )
            tmp.write(chunk)

    if written <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="录音文件为空")

    try:
        row = service.save_recording_upload(
            db,
            user_id=current.id,
            session_id=session_id,
            upload_root_cfg=settings.upload_root,
            source_path=tmp_path,
        )
    finally:
        await audio_file.close()
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    return CallSessionResponse.model_validate(row)


@router.get("/sessions", response_model=list[CallSessionDetailResponse])
def list_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[CallSessionDetailResponse]:
    return service.list_session_details(db, user_id=current.id, limit=limit)


@router.get("/sessions/{session_id}", response_model=CallSessionDetailResponse)
def get_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> CallSessionDetailResponse:
    return service.get_session_detail(db, user_id=current.id, session_id=session_id)


@router.post("/sessions/{session_id}/retranscribe", response_model=CallSessionDetailResponse)
async def retranscribe_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> CallSessionDetailResponse:
    return await service.retranscribe_session(db, user_id=current.id, session_id=session_id)


@router.websocket("/asr/stream")
async def asr_stream(
    websocket: WebSocket,
    session_id: uuid.UUID = Query(...),
    token: str = Query(...),
) -> None:
    user_id = parse_user_id_from_token(token)
    await websocket.accept()

    if user_id is None:
        await websocket.send_json({"type": "error", "message": "token invalid"})
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    asr = service.create_streaming_asr_session()
    audio_judge = service.create_audio_fraud_judge()
    session_row = None
    recent_segments: list[dict[str, object]] = []
    last_ai_eval_at = 0.0
    seq = 0
    try:
        session_row = await service.ensure_ws_session_access(
            db,
            session_id=session_id,
            user_id=user_id,
            websocket=websocket,
        )
        await asr.connect()
        await websocket.send_json({"type": "ready", "session_id": str(session_id)})

        async def emit_risk_events(rows: list[object]) -> None:
            for hit in rows:
                await websocket.send_json(
                    {
                        "type": "risk_event",
                        "event": {
                            "id": str(hit.id),
                            "event_type": hit.event_type,
                            "risk_level": hit.risk_level,
                            "matched_rule": hit.matched_rule,
                            "message": hit.message,
                            "payload": hit.payload,
                            "created_at": hit.created_at.isoformat(),
                        },
                    }
                )

        async def flush_asr_events(timeout: float = 0.0) -> bool:
            nonlocal seq, last_ai_eval_at
            finished = False
            for item in await asr.poll_events(timeout=timeout):
                item_type = str(item.get("type") or "")
                if item_type == "error":
                    await websocket.send_json({"type": "error", "message": item.get("message") or "ASR 处理失败"})
                    finished = True
                    continue
                if item_type == "finished":
                    finished = True
                    continue
                if item_type != "sentence":
                    continue

                text = str(item.get("text") or "").strip()
                if not text:
                    continue

                if not bool(item.get("sentence_end")):
                    await websocket.send_json(
                        {
                            "type": "transcript_partial",
                            "segment": {
                                "id": f"partial-{int(item.get('start_ms') or 0)}",
                                "seq": seq + 1,
                                "start_ms": int(item.get("start_ms") or 0),
                                "end_ms": int(item.get("end_ms") or 0),
                                "text": text,
                                "confidence": item.get("confidence"),
                                "is_final": False,
                            },
                        }
                    )
                    continue

                seq += 1
                segment = service.append_asr_segment(
                    db,
                    session_id=session_id,
                    user_id=user_id,
                    seq=seq,
                    start_ms=int(item.get("start_ms") or 0),
                    end_ms=int(item.get("end_ms") or 0),
                    text=text,
                    confidence=item.get("confidence") if isinstance(item.get("confidence"), float) else None,
                    is_final=True,
                )
                await websocket.send_json(
                    {
                        "type": "transcript",
                        "segment": {
                            "id": str(segment.id),
                            "seq": segment.seq,
                            "start_ms": segment.start_ms,
                            "end_ms": segment.end_ms,
                            "text": segment.text,
                            "confidence": segment.confidence,
                            "is_final": segment.is_final,
                        },
                    }
                )

                recent_segments.append({"seq": segment.seq, "text": segment.text})
                if len(recent_segments) > service.AI_CONTEXT_SEGMENT_LIMIT:
                    del recent_segments[:-service.AI_CONTEXT_SEGMENT_LIMIT]

                risk = service.evaluate_text(text=segment.text)
                created_hits = service.persist_new_risk_hits(
                    db,
                    session_id=session_id,
                    user_id=user_id,
                    hits=risk.hits,
                    payload={"segment_seq": segment.seq, "text": segment.text},
                )
                await emit_risk_events(created_hits)

                now = asyncio.get_running_loop().time()
                if session_row is not None and (segment.seq == 1 or now - last_ai_eval_at >= service.AI_EVAL_COOLDOWN_SECONDS):
                    last_ai_eval_at = now
                    ai_risk = await asyncio.to_thread(
                        service.evaluate_transcript_with_ai,
                        phone_number=session_row.phone_number,
                        risk_level_initial=session_row.risk_level_initial,
                        recent_segments=list(recent_segments),
                    )
                    if ai_risk is not None and service.should_emit_ai_risk(
                        ai_risk_level=ai_risk.risk_level,
                        rule_risk_level=risk.risk_level,
                    ):
                        created_ai_hits = service.persist_ai_risk_evaluation(
                            db,
                            session_id=session_id,
                            user_id=user_id,
                            evaluation=ai_risk,
                            payload=service.build_ai_risk_payload(
                                ai_risk,
                                segment_seq=segment.seq,
                                text=segment.text,
                            ),
                        )
                        await emit_risk_events(created_ai_hits)
            return finished

        while True:
            message = await websocket.receive_json()
            msg_type = str(message.get("type") or "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                await flush_asr_events(0.01)
                continue

            if msg_type == "finalize":
                await asr.finish()
                for _ in range(20):
                    finished = await flush_asr_events(0.2)
                    if finished:
                        break
                await websocket.send_json({"type": "finalized"})
                continue

            if msg_type != "audio_chunk":
                await websocket.send_json({"type": "ignored", "message": "不支持的消息类型"})
                continue

            chunk_base64 = message.get("chunk_base64")
            if not isinstance(chunk_base64, str):
                continue

            audio_bytes = service.decode_audio_chunk(chunk_base64)

            if audio_judge is not None:
                decision = audio_judge.push(audio_bytes)
                if decision is not None:
                    created_hits = service.persist_new_risk_hits(
                        db,
                        session_id=session_id,
                        user_id=user_id,
                        hits=[service.audio_decision_to_hit(decision)],
                        payload={
                            "source": "audio_linear_classifier",
                            "probability": decision.probability,
                            "threshold": decision.threshold,
                            "window_ms": decision.window_ms,
                        },
                    )
                    await emit_risk_events(created_hits)

            await asr.send_audio(audio_bytes)
            await flush_asr_events(0.01)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        try:
            await asr.close()
        except Exception:
            pass
        db.close()
