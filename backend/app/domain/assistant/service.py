"""反诈助手服务。"""
from __future__ import annotations

import base64
import json
import logging
import mimetypes
import uuid
import urllib.error
import urllib.request
from collections import defaultdict
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.assistant import repository as assistant_repository
from app.domain.assistant.entity import AssistantMessage, AssistantSession
from app.domain.detection import repository as detection_repository
from app.domain.detection import retrieval as detection_retrieval
from app.domain.detection import rules as detection_rules
from app.domain.relations import repository as relation_repository
from app.domain.uploads import service as upload_service
from app.domain.user import profile_memory as user_profile_memory
from app.shared.core.config import settings
from app.shared.storage.upload_paths import (
    allocate_batch_folder_name,
    resolved_upload_root,
    safe_suffix,
    save_upload_bytes,
)

_DEFAULT_TITLE = "反诈助手"

_TEXT_DECODE_SUFFIXES = {".txt", ".md", ".json", ".csv", ".log", ".html", ".htm"}
_RELATION_TYPE_LABELS = {
    "family": "亲友",
    "friend": "朋友",
    "classmate": "同学",
    "stranger": "陌生人",
    "colleague": "同事",
}
_KIND_LABELS = {
    "text": "文本",
    "audio": "音频",
    "image": "图片",
    "video": "视频",
}
_KIND_DEFAULT_SUFFIX = {
    "text": ".txt",
    "audio": ".m4a",
    "image": ".jpg",
    "video": ".mp4",
}
_KIND_DEFAULT_MIME = {
    "text": "text/plain",
    "audio": "audio/m4a",
    "image": "image/jpeg",
    "video": "video/mp4",
}
_MULTIMODAL_MAX_IMAGES_PER_MESSAGE = 3
_TEXT_ATTACHMENT_SUFFIXES = _TEXT_DECODE_SUFFIXES | {".pdf", ".doc", ".docx"}

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: str | None, *, fallback: str | None = None, max_length: int | None = None) -> str | None:
    if value is None:
        return fallback
    cleaned = value.strip()
    if not cleaned:
        return fallback
    if max_length is not None:
        cleaned = cleaned[:max_length].strip()
    return cleaned or fallback


def _session_snapshot(session: AssistantSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "user_id": session.user_id,
        "relation_profile_id": session.relation_profile_id,
        "source_submission_id": session.source_submission_id,
        "title": session.title,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


def _message_snapshot(message: AssistantMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "session_id": message.session_id,
        "user_id": message.user_id,
        "role": message.role,
        "content": message.content,
        "extra_payload": dict(message.extra_payload or {}),
        "created_at": message.created_at,
    }


def _build_detail(session: AssistantSession, messages: list[AssistantMessage]) -> dict[str, Any]:
    return {
        "session": _session_snapshot(session),
        "messages": [_message_snapshot(item) for item in messages],
    }


def _touch_session(db: Session, session: AssistantSession) -> AssistantSession:
    session.updated_at = _utcnow()
    return assistant_repository.save_session(db, session)


def _save_message(
    db: Session,
    *,
    session: AssistantSession,
    role: str,
    content: str,
    extra_payload: dict[str, Any] | None = None,
) -> AssistantMessage:
    row = AssistantMessage(
        session_id=session.id,
        user_id=session.user_id,
        role=role,
        content=content,
        extra_payload=extra_payload or {},
    )
    saved = assistant_repository.save_message(db, row)
    _touch_session(db, session)
    return saved


def _decode_text_blob(data: bytes, filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix not in _TEXT_DECODE_SUFFIXES:
        return None
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _read_saved_text_attachment(file_path: str | None) -> str | None:
    normalized = _clean_text(file_path)
    if not normalized:
        return None
    target = (resolved_upload_root(settings.upload_root) / normalized).resolve()
    try:
        data = target.read_bytes()
    except OSError:
        return None
    return _decode_text_blob(data, target.name)


def _read_saved_binary_attachment(file_path: str | None) -> tuple[bytes, str, str] | None:
    normalized = _clean_text(file_path)
    if not normalized:
        return None
    target = (resolved_upload_root(settings.upload_root) / normalized).resolve()
    try:
        data = target.read_bytes()
    except OSError:
        return None
    mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return data, mime_type, target.name


def _build_image_content_items(
    attachments: list[dict[str, Any]],
    *,
    max_items: int = _MULTIMODAL_MAX_IMAGES_PER_MESSAGE,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for attachment in attachments:
        if attachment.get("upload_type") != "image":
            continue
        binary = _read_saved_binary_attachment(
            attachment.get("file_path") if isinstance(attachment.get("file_path"), str) else None
        )
        if binary is None:
            continue
        data, mime_type, _ = binary
        if not mime_type.startswith("image/"):
            continue
        encoded = base64.b64encode(data).decode("ascii")
        items.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
            }
        )
        if len(items) >= max_items:
            break
    return items


def _build_image_content_items_from_paths(
    file_paths: list[str],
    *,
    max_items: int = _MULTIMODAL_MAX_IMAGES_PER_MESSAGE,
) -> list[dict[str, Any]]:
    attachments = [{"upload_type": "image", "file_path": item} for item in file_paths]
    return _build_image_content_items(attachments, max_items=max_items)


def _guess_attachment_kind_from_path(file_path: str | None) -> str | None:
    normalized = _clean_text(file_path)
    if not normalized:
        return None
    name = Path(normalized).name
    mime_type = mimetypes.guess_type(name)[0] or ""
    suffix = Path(name).suffix.lower()
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("text/") or suffix in _TEXT_ATTACHMENT_SUFFIXES:
        return "text"
    return None


def _extract_attachment_items(extra_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = (extra_payload or {}).get("attachments")
    if not isinstance(raw, list):
        return []

    items: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        upload_type = str(item.get("upload_type") or item.get("kind") or "").strip().lower()
        if upload_type not in _KIND_LABELS:
            continue
        file_path = _clean_text(str(item.get("file_path") or ""), fallback="") or ""
        name = _clean_text(item.get("name") if isinstance(item.get("name"), str) else None)
        if not name:
            name = Path(file_path).name or f"{_KIND_LABELS[upload_type]}附件"
        items.append(
            {
                "upload_id": _clean_text(str(item.get("upload_id") or ""), fallback=None),
                "storage_batch_id": _clean_text(str(item.get("storage_batch_id") or ""), fallback=None),
                "upload_type": upload_type,
                "file_path": file_path,
                "name": name,
                "mime_type": _clean_text(item.get("mime_type") if isinstance(item.get("mime_type"), str) else None),
                "preview_text": _clean_text(item.get("preview_text") if isinstance(item.get("preview_text"), str) else None),
            }
        )
    return items


def _build_attachment_overview(attachments: list[dict[str, Any]]) -> str | None:
    if not attachments:
        return None

    grouped: dict[str, list[str]] = defaultdict(list)
    for item in attachments:
        upload_type = str(item.get("upload_type") or "").strip().lower()
        name = _clean_text(item.get("name") if isinstance(item.get("name"), str) else None)
        if upload_type not in _KIND_LABELS or not name:
            continue
        grouped[upload_type].append(name)

    lines: list[str] = []
    for kind in ("text", "image", "audio", "video"):
        names = grouped.get(kind) or []
        if not names:
            continue
        if kind == "image":
            lines.append(f"{_KIND_LABELS[kind]}：共 {len(names)} 张")
            continue
        if kind == "video":
            lines.append(f"{_KIND_LABELS[kind]}：共 {len(names)} 个（暂不解析具体画面）")
            continue
        preview = "、".join(names[:4])
        if len(names) > 4:
            preview = f"{preview} 等 {len(names)} 项"
        lines.append(f"{_KIND_LABELS[kind]}：{preview}")

    if not lines:
        return None
    return "附件：\n- " + "\n- ".join(lines)


def _build_text_attachment_blocks(attachments: list[dict[str, Any]]) -> list[str]:
    blocks: list[str] = []
    for item in attachments:
        if item.get("upload_type") != "text":
            continue
        name = _clean_text(item.get("name") if isinstance(item.get("name"), str) else None, fallback="文本附件") or "文本附件"
        content = _read_saved_text_attachment(item.get("file_path") if isinstance(item.get("file_path"), str) else None)
        if not content:
            preview = _clean_text(item.get("preview_text") if isinstance(item.get("preview_text"), str) else None)
            if not preview:
                continue
            content = preview
        blocks.append(f"{name}：\n{content.strip()}")
    return blocks


def _message_prompt_content(message: AssistantMessage) -> str:
    blocks: list[str] = []
    extra_payload = message.extra_payload if isinstance(message.extra_payload, dict) else {}
    active_relation_name = _clean_text(
        extra_payload.get("active_relation_profile_name")
        if isinstance(extra_payload.get("active_relation_profile_name"), str)
        else None
    )
    if active_relation_name and message.role == "user":
        blocks.append(f"当前对象：{active_relation_name}")
    content = _clean_text(message.content)
    if content:
        blocks.append(content)

    attachments = _extract_attachment_items(extra_payload)
    attachment_overview = _build_attachment_overview(attachments)
    if attachment_overview:
        blocks.append(attachment_overview)

    text_blocks = _build_text_attachment_blocks(attachments)
    if text_blocks:
        blocks.append("文本附件内容：\n\n" + "\n\n".join(text_blocks))

    return "\n\n".join(blocks).strip()


def _message_prompt_payload(message: AssistantMessage) -> str | list[dict[str, Any]] | None:
    text_content = _message_prompt_content(message)
    attachments = _extract_attachment_items(message.extra_payload if isinstance(message.extra_payload, dict) else {})
    image_items = _build_image_content_items(attachments) if message.role == "user" else []

    if image_items:
        payload: list[dict[str, Any]] = []
        if text_content:
            payload.append({"type": "text", "text": text_content})
        payload.extend(image_items)
        return payload

    if text_content:
        return text_content
    return None


def _build_history_lines(messages: list[AssistantMessage]) -> str:
    lines: list[str] = []
    for item in messages:
        if item.role not in {"user", "assistant"}:
            continue
        content = _message_prompt_content(item)
        if not content:
            continue
        prefix = "用户" if item.role == "user" else "助手"
        lines.append(f"{prefix}：{content}")
    return "\n\n".join(lines)


def _build_relation_context(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None,
) -> tuple[str | None, str | None, list[dict[str, Any]]]:
    if relation_profile_id is None:
        return None, None, []

    profile = relation_repository.get_profile_for_user(
        db,
        user_id=user_id,
        relation_id=relation_profile_id,
    )
    if profile is None:
        return None, None, []

    memories = relation_repository.list_memories_for_relation(
        db,
        user_id=user_id,
        relation_id=profile.id,
    )
    links = relation_repository.list_links_for_relation(
        db,
        user_id=user_id,
        relation_id=profile.id,
    )

    blocks: list[str] = []
    summary_lines = [
        f"姓名：{profile.name}",
        f"关系：{_RELATION_TYPE_LABELS.get(profile.relation_type, profile.relation_type)}",
    ]
    description = _clean_text(profile.description)
    if description:
        summary_lines.append(f"简介：{description}")
    tags = [str(item).strip() for item in list(profile.tags or []) if str(item).strip()]
    if tags:
        summary_lines.append("标签：" + "、".join(tags))
    blocks.append("对象资料：\n- " + "\n- ".join(summary_lines))

    if memories:
        memory_lines: list[str] = []
        for item in memories:
            scope = "长期" if item.memory_scope == "long_term" else "短期"
            title = _clean_text(item.title, fallback="记忆") or "记忆"
            if item.memory_kind == "upload":
                if "图片" in title:
                    content = "已关联图片记录"
                elif "视频" in title:
                    content = "已关联视频记录（当前暂不解析具体画面）"
                elif "音频" in title:
                    content = "已关联音频记录"
                else:
                    content = "已关联文档/文本记录"
            else:
                content = _clean_text(item.content)
            if not content:
                continue
            memory_lines.append(f"[{scope}/{item.memory_kind}] {title}：{content}")
        if memory_lines:
            blocks.append("对象记忆：\n- " + "\n- ".join(memory_lines))

    relation_image_items: list[dict[str, Any]] = []
    if links:
        unique_paths: list[str] = []
        seen_paths: set[str] = set()
        for link in links:
            file_path = _clean_text(link.file_path)
            if not file_path or file_path in seen_paths:
                continue
            seen_paths.add(file_path)
            unique_paths.append(file_path)

        kind_counts: dict[str, int] = defaultdict(int)
        image_paths: list[str] = []
        for file_path in unique_paths:
            kind = _guess_attachment_kind_from_path(file_path) or "other"
            kind_counts[kind] += 1
            if kind == "image":
                image_paths.append(file_path)

        relation_image_items = _build_image_content_items_from_paths(image_paths)
        attachment_lines: list[str] = []
        if kind_counts.get("image"):
            provided_count = len(relation_image_items)
            image_note = f"，已附上前 {provided_count} 张供视觉分析" if provided_count else ""
            attachment_lines.append(f"图片：共 {kind_counts['image']} 张{image_note}")
        if kind_counts.get("video"):
            attachment_lines.append(f"视频：共 {kind_counts['video']} 个（当前暂不解析具体画面）")
        if kind_counts.get("audio"):
            attachment_lines.append(f"音频：共 {kind_counts['audio']} 个")
        if kind_counts.get("text"):
            attachment_lines.append(f"文档/文本：共 {kind_counts['text']} 份")
        if kind_counts.get("other"):
            attachment_lines.append(f"其他附件：共 {kind_counts['other']} 项")
        if attachment_lines:
            blocks.append("对象关联附件：\n- " + "\n- ".join(attachment_lines))

    return profile.name, "\n\n".join(blocks), relation_image_items


def _build_user_context(db: Session, *, user_id: uuid.UUID) -> str | None:
    return user_profile_memory.build_user_memory_prompt_context(db, user_id=user_id)


def _build_submission_context(db: Session, session: AssistantSession) -> str | None:
    if session.source_submission_id is None:
        return None
    submission = detection_repository.get_submission_for_user(
        db,
        submission_id=session.source_submission_id,
        user_id=session.user_id,
    )
    if submission is None:
        return None

    blocks: list[str] = []
    text_content = _clean_text(submission.text_content)
    if text_content:
        blocks.append("记录正文：\n" + text_content)

    attachment_lines: list[str] = []
    for kind, paths in (
        ("text", list(submission.text_paths or [])),
        ("image", list(submission.image_paths or [])),
        ("audio", list(submission.audio_paths or [])),
        ("video", list(submission.video_paths or [])),
    ):
        if not paths:
            continue
        names = [Path(path).name for path in paths if path]
        if not names:
            continue
        preview = "、".join(names[:12])
        if len(names) > 12:
            preview = f"{preview} 等 {len(names)} 项"
        attachment_lines.append(f"{_KIND_LABELS[kind]}：{preview}")
    if attachment_lines:
        blocks.append("记录附件：\n- " + "\n- ".join(attachment_lines))

    if not blocks:
        return None
    return "\n\n".join(blocks)


def _short_text(value: str | None, *, limit: int = 72) -> str | None:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "…"


def _build_retrieval_context(
    db: Session,
    *,
    user_text: str,
) -> tuple[dict[str, Any], list[str]]:
    normalized = detection_rules.normalize_text(user_text)
    if not normalized:
        return {
            "rule_score": 0,
            "hit_rules": [],
            "fraud_type_hints": [],
            "stage_tags": [],
            "references": [],
        }, []
    rule_analysis = detection_rules.analyze_text(normalized)

    snippets: list[str] = []
    references: list[dict[str, Any]] = []
    try:
        retrieval_bundle = detection_retrieval.retrieve_text_evidence(
            db,
            text=normalized,
            rule_analysis=rule_analysis,
        )
        for hit in retrieval_bundle.black_hits[:2]:
            snippet = _short_text(hit.chunk_text)
            if not snippet:
                continue
            references.append(
                {
                    "sample_label": hit.sample_label,
                    "fraud_type": hit.fraud_type,
                    "data_source": hit.data_source,
                    "similarity_score": round(float(hit.score), 4),
                }
            )
            fraud_type = hit.fraud_type or "风险样本"
            snippets.append(f"风险参照·{fraud_type}：{snippet}")
        for hit in retrieval_bundle.white_hits[:1]:
            snippet = _short_text(hit.chunk_text)
            if not snippet:
                continue
            references.append(
                {
                    "sample_label": hit.sample_label,
                    "fraud_type": hit.fraud_type,
                    "data_source": hit.data_source,
                    "similarity_score": round(float(hit.score), 4),
                }
            )
            snippets.append(f"正常参照：{snippet}")
    except Exception:
        references = []

    summary = {
        "rule_score": rule_analysis.rule_score,
        "hit_rules": rule_analysis.hit_rules[:8],
        "fraud_type_hints": rule_analysis.fraud_type_hints[:6],
        "stage_tags": rule_analysis.stage_tags[:6],
        "references": references,
    }
    return summary, snippets


def _build_context_blob(
    *,
    user_context: str | None,
    relation_context: str | None,
    submission_context: str | None,
    current_upload_context: str | None,
    retrieval_summary: dict[str, Any],
    retrieval_lines: list[str],
) -> str:
    blocks: list[str] = []

    if user_context:
        blocks.append(user_context)
    if relation_context:
        blocks.append("当前选中对象补充记忆：\n" + relation_context)
    if submission_context:
        blocks.append("关联记录全量上下文：\n" + submission_context)
    if current_upload_context:
        blocks.append("本轮新上传附件：\n" + current_upload_context)

    hint_lines: list[str] = []
    hit_rules = retrieval_summary.get("hit_rules") or []
    if hit_rules:
        hint_lines.append("命中规则：" + "、".join(str(item) for item in hit_rules))
    fraud_type_hints = retrieval_summary.get("fraud_type_hints") or []
    if fraud_type_hints:
        hint_lines.append("类型线索：" + "、".join(str(item) for item in fraud_type_hints))
    stage_tags = retrieval_summary.get("stage_tags") or []
    if stage_tags:
        hint_lines.append("风险阶段：" + "、".join(str(item) for item in stage_tags))
    if hint_lines:
        blocks.append("快速判断：\n- " + "\n- ".join(hint_lines))

    if retrieval_lines:
        blocks.append("知识库参照：\n- " + "\n- ".join(retrieval_lines))

    return "\n\n".join(blocks)


def _assistant_system_prompt() -> str:
    return (
        "你是移动端反诈助手。"
        "只用简体中文回答。"
        "必须把当前消息、整段会话、附件内容、用户画像、对象记忆一起对照分析。"
        "用户可能临时选择一个对象作为补充记忆，这不会创建新会话，但你必须使用这部分资料辅助判断。"
        "重点判断身份是否匹配、语气是否异常、诉求是否突然变化、是否存在借钱转账、验证码、远程控制、下载 App、保密施压等风险。"
        "如果会话绑定了某条记录，必须结合这条记录的全部上下文，不要只看摘要。"
        "输出尽量短，但要有结论。"
        "用户画像、内部风险分、内部记忆仅用于内部推理，不得直接向用户复述。"
        "证据不足时，不要默认判定诈骗。"
        "理由优先引用当前消息、附件、明确事实；用户画像仅作辅助，不直接外显。"
        "信息不足时，可以只追问 1 个最关键的问题。"
        "不要写营销文案，不要铺垫。"
    )


def _extract_chat_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("assistant llm response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        return "".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in content
        ).strip()
    return str(content or "").strip()


def _call_assistant_llm(messages: list[dict[str, Any]]) -> str:
    provider = settings.assistant_llm_provider.strip().lower()
    if provider != "openai_compatible":
        raise RuntimeError(f"Unsupported assistant llm provider: {settings.assistant_llm_provider}")

    api_key = (settings.assistant_llm_api_key or settings.detection_llm_api_key or "").strip()
    if not api_key:
        raise RuntimeError("ASSISTANT_LLM_API_KEY is required")

    request_payload = {
        "model": settings.assistant_llm_model,
        "messages": messages,
        "temperature": settings.assistant_llm_temperature,
        "max_tokens": settings.assistant_llm_max_tokens,
        "stream": False,
        "enable_thinking": settings.assistant_llm_enable_thinking,
    }
    request = urllib.request.Request(
        settings.assistant_llm_api_url,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.assistant_llm_timeout_seconds) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"assistant llm request failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"assistant llm request failed: {exc.reason}") from exc

    payload = json.loads(body)
    content = _extract_chat_content(payload)
    if not content:
        raise RuntimeError("assistant llm returned empty content")
    return content


def _iter_chat_content_stream(messages: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    provider = settings.assistant_llm_provider.strip().lower()
    if provider != "openai_compatible":
        raise RuntimeError(f"Unsupported assistant llm provider: {settings.assistant_llm_provider}")

    api_key = (settings.assistant_llm_api_key or settings.detection_llm_api_key or "").strip()
    if not api_key:
        raise RuntimeError("ASSISTANT_LLM_API_KEY is required")

    request_payload = {
        "model": settings.assistant_llm_model,
        "messages": messages,
        "temperature": settings.assistant_llm_temperature,
        "max_tokens": settings.assistant_llm_max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
        "enable_thinking": settings.assistant_llm_enable_thinking,
    }
    request = urllib.request.Request(
        settings.assistant_llm_api_url,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    def flush_lines(lines: list[str]) -> dict[str, Any] | None:
        if not lines:
            return None
        data_lines = [line[5:].strip() for line in lines if line.startswith("data:")]
        if not data_lines:
            return None
        raw_data = "\n".join(data_lines).strip()
        if not raw_data or raw_data == "[DONE]":
            return {"type": "done"}
        payload = json.loads(raw_data)
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            delta = choices[0].get("delta") or {}
            reasoning = delta.get("reasoning_content")
            content = delta.get("content")
            if reasoning:
                return {"type": "delta", "phase": "reasoning", "text": str(reasoning)}
            if content:
                return {"type": "delta", "phase": "answer", "text": str(content)}
        usage = payload.get("usage")
        if usage:
            return {"type": "usage", "usage": usage}
        return None

    try:
        with urllib.request.urlopen(request, timeout=settings.assistant_llm_timeout_seconds) as response:
            event_lines: list[str] = []
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="ignore").rstrip("\r\n")
                if not line:
                    event = flush_lines(event_lines)
                    event_lines = []
                    if event is not None:
                        yield event
                    continue
                if line.startswith(":"):
                    continue
                event_lines.append(line)
            event = flush_lines(event_lines)
            if event is not None:
                yield event
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"assistant llm request failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"assistant llm request failed: {exc.reason}") from exc


def _build_fallback_reply(
    *,
    user_text: str,
    retrieval_summary: dict[str, Any],
    relation_name: str | None = None,
) -> str:
    rule_score = int(retrieval_summary.get("rule_score") or 0)
    hit_rules = [str(item) for item in (retrieval_summary.get("hit_rules") or []) if item][:3]
    fraud_hints = [str(item) for item in (retrieval_summary.get("fraud_type_hints") or []) if item][:2]

    subject = f"这和“{relation_name}”有关的内容" if relation_name else "这段内容"
    if rule_score >= 55:
        conclusion = f"结论：{subject}偏高风险，先不要继续操作。"
    elif rule_score >= 28:
        conclusion = f"结论：{subject}有明显风险信号，建议先停一下。"
    else:
        conclusion = "结论：暂不能直接确认，但要继续核验。"

    reason_parts: list[str] = []
    if hit_rules:
        reason_parts.append("原因：" + "、".join(hit_rules))
    if fraud_hints:
        reason_parts.append("线索：" + "、".join(fraud_hints))
    if not reason_parts:
        reason_parts.append("原因：当前信息还不够完整。")

    advice = "建议：不要转账，不要给验证码，不要点陌生链接；把关键聊天或截图继续发我。"
    if "验证码" in user_text:
        advice = "建议：验证码不要给任何人；如果已泄露，立刻改密并核查账户。"
    return "\n".join([conclusion, *reason_parts, advice])


def _normalize_file_bundles(
    file_bundles: dict[str, list[tuple[bytes, str]]] | None,
) -> dict[str, list[tuple[bytes, str]]]:
    normalized: dict[str, list[tuple[bytes, str]]] = {
        "text": [],
        "audio": [],
        "image": [],
        "video": [],
    }
    for kind in normalized:
        for data, filename in list((file_bundles or {}).get(kind, [])):
            name = _clean_text(filename)
            if not data or not name:
                continue
            normalized[kind].append((data, name))
    return normalized


def _has_file_bundles(file_bundles: dict[str, list[tuple[bytes, str]]]) -> bool:
    return any(file_bundles.get(kind) for kind in ("text", "audio", "image", "video"))


def _store_upload_bundle(
    db: Session,
    *,
    user_id: uuid.UUID,
    file_bundles: dict[str, list[tuple[bytes, str]]],
) -> list[dict[str, Any]]:
    if not _has_file_bundles(file_bundles):
        return []

    upload_root = resolved_upload_root(settings.upload_root)
    upload_root.mkdir(parents=True, exist_ok=True)
    batch_folder = allocate_batch_folder_name(upload_root=upload_root, user_id=user_id)

    saved_paths: dict[str, list[str]] = {
        "text": [],
        "audio": [],
        "image": [],
        "video": [],
    }
    attachment_items: list[dict[str, Any]] = []

    for kind in ("text", "audio", "image", "video"):
        default_suffix = _KIND_DEFAULT_SUFFIX[kind]
        for data, filename in file_bundles.get(kind, []):
            path = save_upload_bytes(
                upload_root=upload_root,
                user_id=user_id,
                batch_folder=batch_folder,
                kind=kind,
                data=data,
                suffix=safe_suffix(filename, default_suffix),
            )
            saved_paths[kind].append(path)
            decoded_text = _decode_text_blob(data, filename) if kind == "text" else None
            attachment_items.append(
                {
                    "upload_id": None,
                    "storage_batch_id": batch_folder,
                    "upload_type": kind,
                    "file_path": path,
                    "name": Path(filename).name,
                    "mime_type": mimetypes.guess_type(filename)[0] or _KIND_DEFAULT_MIME[kind],
                    "preview_text": _short_text(decoded_text, limit=240),
                }
            )

    upload_rows = upload_service.sync_upload_bundle(
        db,
        user_id=user_id,
        storage_batch_id=batch_folder,
        text_paths=saved_paths["text"],
        audio_paths=saved_paths["audio"],
        image_paths=saved_paths["image"],
        video_paths=saved_paths["video"],
        source_submission_id=None,
    )
    row_map = {row.upload_type: row for row in upload_rows}
    for item in attachment_items:
        row = row_map.get(str(item.get("upload_type") or ""))
        if row is None:
            continue
        item["upload_id"] = str(row.id)
        item["storage_batch_id"] = row.storage_batch_id
    return attachment_items


def _build_current_upload_context(attachments: list[dict[str, Any]]) -> str | None:
    overview = _build_attachment_overview(attachments)
    text_blocks = _build_text_attachment_blocks(attachments)

    blocks: list[str] = []
    if overview:
        blocks.append(overview)
    if text_blocks:
        blocks.append("文本附件内容：\n\n" + "\n\n".join(text_blocks))
    if not blocks:
        return None
    return "\n\n".join(blocks)


def _compose_analysis_text(user_text: str | None, attachments: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    cleaned = _clean_text(user_text)
    if cleaned:
        blocks.append(cleaned)

    text_blocks = _build_text_attachment_blocks(attachments)
    if text_blocks:
        blocks.extend(text_blocks)

    if not text_blocks:
        kind_counts: dict[str, int] = defaultdict(int)
        for item in attachments:
            upload_type = str(item.get("upload_type") or "").strip().lower()
            if upload_type:
                kind_counts[upload_type] += 1
        hint_lines: list[str] = []
        if kind_counts.get("image"):
            hint_lines.append(f"图片共 {kind_counts['image']} 张")
        if kind_counts.get("video"):
            hint_lines.append(f"视频共 {kind_counts['video']} 个")
        if kind_counts.get("audio"):
            hint_lines.append(f"音频共 {kind_counts['audio']} 个")
        if hint_lines:
            blocks.append("附件概况：" + "；".join(hint_lines))

    return "\n\n".join(blocks).strip()


def _derive_session_title(
    *,
    session: AssistantSession,
    user_text: str | None,
    attachments: list[dict[str, Any]],
    relation_name: str | None,
) -> str:
    cleaned = _clean_text(user_text, max_length=18)
    if cleaned:
        return cleaned
    if attachments:
        first_name = _clean_text(
            attachments[0].get("name") if isinstance(attachments[0].get("name"), str) else None,
            max_length=18,
        )
        if first_name:
            return first_name
    if relation_name:
        relation_title = _clean_text(relation_name, max_length=18)
        if relation_title:
            return relation_title
    return session.title or _DEFAULT_TITLE





def _prepare_assistant_request(
    db: Session,
    *,
    session: AssistantSession,
    messages: list[AssistantMessage],
    user_text: str,
    relation_profile_id: uuid.UUID | None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], str | None]:
    current_uploads = _extract_attachment_items(messages[-1].extra_payload if messages else {})
    user_context = _build_user_context(db, user_id=session.user_id)
    relation_name, relation_context, relation_image_items = _build_relation_context(
        db,
        user_id=session.user_id,
        relation_profile_id=relation_profile_id,
    )
    submission_context = _build_submission_context(db, session)
    current_upload_context = _build_current_upload_context(current_uploads)

    analysis_text = _compose_analysis_text(user_text, current_uploads)
    retrieval_summary, retrieval_lines = _build_retrieval_context(db, user_text=analysis_text)
    context_blob = _build_context_blob(
        user_context=user_context,
        relation_context=relation_context,
        submission_context=submission_context,
        current_upload_context=current_upload_context,
        retrieval_summary=retrieval_summary,
        retrieval_lines=retrieval_lines,
    )

    prompt_messages: list[dict[str, Any]] = [{"role": "system", "content": _assistant_system_prompt()}]
    if context_blob:
        prompt_messages.append({"role": "system", "content": context_blob})
    if relation_image_items:
        relation_visual_hint = (
            f"系统补充资料：以下图片来自当前选中对象“{relation_name}”的关联图片，仅供内部分析。"
            if relation_name
            else "系统补充资料：以下图片来自当前选中对象的关联图片，仅供内部分析。"
        )
        prompt_messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": relation_visual_hint
                        + "请直接结合画面内容判断，但不要向用户泄露内部文件名、路径、存储结构或实现细节。",
                    },
                    *relation_image_items,
                ],
            }
        )
    for item in messages:
        if item.role not in {"user", "assistant"}:
            continue
        content = _message_prompt_payload(item)
        if not content:
            continue
        prompt_messages.append({"role": item.role, "content": content})

    extra_payload = {
        "context_history": _build_history_lines(messages),
        "relation_profile_id": str(relation_profile_id) if relation_profile_id else None,
        "relation_profile_name": relation_name,
        "user_context": user_context,
        "rule_score": retrieval_summary.get("rule_score"),
        "hit_rules": retrieval_summary.get("hit_rules") or [],
        "fraud_type_hints": retrieval_summary.get("fraud_type_hints") or [],
        "stage_tags": retrieval_summary.get("stage_tags") or [],
        "references": retrieval_summary.get("references") or [],
        "current_uploads": current_uploads,
    }
    return prompt_messages, extra_payload, retrieval_summary, relation_name


def _generate_assistant_reply(
    db: Session,
    *,
    session: AssistantSession,
    messages: list[AssistantMessage],
    user_text: str,
    relation_profile_id: uuid.UUID | None,
) -> tuple[str, dict[str, Any]]:
    prompt_messages, extra_payload, retrieval_summary, relation_name = _prepare_assistant_request(
        db,
        session=session,
        messages=messages,
        user_text=user_text,
        relation_profile_id=relation_profile_id,
    )

    try:
        content = _call_assistant_llm(prompt_messages)
    except Exception:
        content = _build_fallback_reply(
            user_text=user_text,
            retrieval_summary=retrieval_summary,
            relation_name=relation_name,
        )

    return content, extra_payload


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def create_session(
    db: Session,
    *,
    user_id: uuid.UUID,
    relation_profile_id: uuid.UUID | None = None,
    source_submission_id: uuid.UUID | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    relation_name: str | None = None
    if relation_profile_id is not None:
        relation = relation_repository.get_profile_for_user(
            db,
            user_id=user_id,
            relation_id=relation_profile_id,
        )
        if relation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")
        relation_name = relation.name

    if source_submission_id is not None:
        submission = detection_repository.get_submission_for_user(
            db,
            submission_id=source_submission_id,
            user_id=user_id,
        )
        if submission is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="检测记录不存在")

    session = AssistantSession(
        user_id=user_id,
        relation_profile_id=relation_profile_id,
        source_submission_id=source_submission_id,
        title=_clean_text(title or relation_name, fallback=_DEFAULT_TITLE, max_length=24) or _DEFAULT_TITLE,
    )
    session = assistant_repository.save_session(db, session)
    return _build_detail(session, [])


def list_sessions(
    db: Session,
    *,
    user_id: uuid.UUID,
    limit: int = 20,
) -> list[dict[str, Any]]:
    normalized_limit = max(1, min(limit, 100))
    sessions = assistant_repository.list_sessions_for_user(
        db,
        user_id=user_id,
        limit=min(100, max(normalized_limit * 4, 24)),
    )

    visible_sessions: list[dict[str, Any]] = []
    for item in sessions:
        recent_messages = assistant_repository.list_recent_messages_for_session(db, session_id=item.id, limit=6)
        if not any(message.role == "user" for message in recent_messages):
            continue
        visible_sessions.append(_session_snapshot(item))
        if len(visible_sessions) >= normalized_limit:
            break

    return visible_sessions


def get_session_detail(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> dict[str, Any]:
    session = assistant_repository.get_session_for_user(db, session_id=session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    messages = assistant_repository.list_messages_for_session(db, session_id=session.id)
    return _build_detail(session, messages)


def send_message(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    content: str,
    relation_profile_id: uuid.UUID | None = None,
    file_bundles: dict[str, list[tuple[bytes, str]]] | None = None,
) -> dict[str, Any]:
    session = assistant_repository.get_session_for_user(db, session_id=session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")

    normalized_bundles = _normalize_file_bundles(file_bundles)
    attachment_items = _store_upload_bundle(db, user_id=user_id, file_bundles=normalized_bundles)
    cleaned_content = _clean_text(content, max_length=1200) or ""
    if not cleaned_content and not attachment_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入内容或上传附件")

    relation_name, _, _ = _build_relation_context(
        db,
        user_id=user_id,
        relation_profile_id=relation_profile_id,
    )
    if relation_profile_id is not None and relation_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    user_message = _save_message(
        db,
        session=session,
        role="user",
        content=cleaned_content,
        extra_payload={
            "attachments": attachment_items,
            "active_relation_profile_id": str(relation_profile_id) if relation_profile_id else None,
            "active_relation_profile_name": relation_name,
        },
    )
    messages = assistant_repository.list_messages_for_session(db, session_id=session.id)

    user_messages = [item for item in messages if item.role == "user"]
    if len(user_messages) <= 1:
        session.title = _derive_session_title(
            session=session,
            user_text=cleaned_content,
            attachments=attachment_items,
            relation_name=relation_name,
        )
        session = _touch_session(db, session)

    assistant_content, extra_payload = _generate_assistant_reply(
        db,
        session=session,
        messages=messages,
        user_text=cleaned_content,
        relation_profile_id=relation_profile_id,
    )
    assistant_message = _save_message(
        db,
        session=session,
        role="assistant",
        content=assistant_content,
        extra_payload=extra_payload,
    )
    try:
        user_profile_memory.refresh_user_profile_from_assistant_turn(
            db,
            user_id=user_id,
            session=session,
            user_message=user_message,
            assistant_message=assistant_message,
            relation_profile_id=relation_profile_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Assistant profile refresh failed: session=%s", session.id)

    return {
        "session": _session_snapshot(session),
        "user_message": _message_snapshot(user_message),
        "assistant_message": _message_snapshot(assistant_message),
    }


def stream_message(
    db: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    content: str | None,
    relation_profile_id: uuid.UUID | None = None,
    file_bundles: dict[str, list[tuple[bytes, str]]] | None = None,
) -> Iterator[str]:
    session = assistant_repository.get_session_for_user(db, session_id=session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")

    normalized_bundles = _normalize_file_bundles(file_bundles)
    attachment_items = _store_upload_bundle(db, user_id=user_id, file_bundles=normalized_bundles)
    cleaned_content = _clean_text(content, max_length=1200) or ""
    if not cleaned_content and not attachment_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入内容或上传附件")

    relation_name, _, _ = _build_relation_context(
        db,
        user_id=user_id,
        relation_profile_id=relation_profile_id,
    )
    if relation_profile_id is not None and relation_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系对象不存在")

    user_message = _save_message(
        db,
        session=session,
        role="user",
        content=cleaned_content,
        extra_payload={
            "attachments": attachment_items,
            "active_relation_profile_id": str(relation_profile_id) if relation_profile_id else None,
            "active_relation_profile_name": relation_name,
        },
    )
    messages = assistant_repository.list_messages_for_session(db, session_id=session.id)

    user_messages = [item for item in messages if item.role == "user"]
    if len(user_messages) <= 1:
        session.title = _derive_session_title(
            session=session,
            user_text=cleaned_content,
            attachments=attachment_items,
            relation_name=relation_name,
        )
        session = _touch_session(db, session)

    assistant_message = _save_message(
        db,
        session=session,
        role="assistant",
        content="",
        extra_payload={"stream_status": "started"},
    )

    prompt_messages, extra_payload, retrieval_summary, relation_name = _prepare_assistant_request(
        db,
        session=session,
        messages=messages,
        user_text=cleaned_content,
        relation_profile_id=relation_profile_id,
    )

    usage: dict[str, Any] | None = None
    parts: list[str] = []
    yield _sse_event(
        "ack",
        {
            "session": _session_snapshot(session),
            "user_message": _message_snapshot(user_message),
            "assistant_message": _message_snapshot(assistant_message),
        },
    )

    try:
        for item in _iter_chat_content_stream(prompt_messages):
            if item.get("type") == "delta":
                delta = str(item.get("text") or "")
                if not delta:
                    continue
                parts.append(delta)
                yield _sse_event(
                    "delta",
                    {
                        "assistant_message_id": str(assistant_message.id),
                        "delta": delta,
                        "phase": item.get("phase") or "answer",
                    },
                )
            elif item.get("type") == "usage":
                maybe_usage = item.get("usage")
                if isinstance(maybe_usage, dict):
                    usage = maybe_usage
    except Exception:
        if not parts:
            fallback_text = _build_fallback_reply(
                user_text=cleaned_content,
                retrieval_summary=retrieval_summary,
                relation_name=relation_name,
            )
            parts.append(fallback_text)
            yield _sse_event(
                "delta",
                {
                    "assistant_message_id": str(assistant_message.id),
                    "delta": fallback_text,
                    "phase": "answer",
                },
            )

    final_content = "".join(parts).strip()
    assistant_message.content = final_content
    assistant_message.extra_payload = {
        **extra_payload,
        "usage": usage or {},
        "stream_status": "completed",
    }
    assistant_message = assistant_repository.save_message(db, assistant_message)
    session = _touch_session(db, session)
    try:
        user_profile_memory.refresh_user_profile_from_assistant_turn(
            db,
            user_id=user_id,
            session=session,
            user_message=user_message,
            assistant_message=assistant_message,
            relation_profile_id=relation_profile_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Assistant profile refresh failed: session=%s", session.id)

    yield _sse_event(
        "done",
        {
            "session": _session_snapshot(session),
            "assistant_message": _message_snapshot(assistant_message),
        },
    )
    yield "data: [DONE]\n\n"
