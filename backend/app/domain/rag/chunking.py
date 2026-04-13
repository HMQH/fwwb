"""Chunking helpers for text and website knowledge."""
from __future__ import annotations

import re


_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?；;.!?])|(?:\n+)")


def normalize_text(text: str | None) -> str:
    """Normalize line endings and repeated whitespace without flattening structure."""
    if not text:
        return ""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u3000", " ")
    normalized = _MULTI_SPACE_RE.sub(" ", normalized)
    normalized = _MULTI_NEWLINE_RE.sub("\n\n", normalized)
    lines = [line.strip() for line in normalized.split("\n")]
    normalized = "\n".join(lines)
    return normalized.strip()


def _split_long_piece(piece: str, hard_limit: int) -> list[str]:
    if len(piece) <= hard_limit:
        return [piece]
    return [piece[i : i + hard_limit] for i in range(0, len(piece), hard_limit)]


def _sentence_like_pieces(text: str, hard_limit: int) -> list[str]:
    raw_pieces = [segment for segment in _SENTENCE_SPLIT_RE.split(text) if segment]
    pieces: list[str] = []
    for raw_piece in raw_pieces:
        piece = raw_piece.strip()
        if not piece:
            continue
        pieces.extend(_split_long_piece(piece, hard_limit))
    return pieces


def split_text(
    text: str,
    *,
    soft_limit: int,
    hard_limit: int,
    overlap: int,
) -> list[str]:
    """Split text into moderately sized chunks with a small character overlap."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    if len(normalized) <= soft_limit:
        return [normalized]

    pieces = _sentence_like_pieces(normalized, hard_limit)
    if not pieces:
        return [normalized[i : i + hard_limit] for i in range(0, len(normalized), hard_limit)]

    chunks: list[str] = []
    current = ""

    for piece in pieces:
        if not current:
            current = piece
            continue

        separator = "" if current.endswith("\n") or piece.startswith("\n") else " "
        candidate = f"{current}{separator}{piece}"
        if len(candidate) <= soft_limit:
            current = candidate
            continue

        chunks.append(current.strip())
        tail = current[-overlap:] if overlap > 0 else ""
        current = f"{tail}{separator}{piece}".strip()
        if len(current) > hard_limit:
            long_parts = _split_long_piece(current, hard_limit)
            if len(long_parts) > 1:
                chunks.extend(long_parts[:-1])
                current = long_parts[-1]

    if current.strip():
        chunks.append(current.strip())

    return [chunk for chunk in chunks if chunk]
