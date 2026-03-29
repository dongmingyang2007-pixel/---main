from __future__ import annotations

import re

_FENCE_BLOCK_PATTERN = re.compile(r"(```[\s\S]*?```)")
_COLON_BULLET_PATTERN = re.compile(r"([：:])\s*[-*•]\s*(?=\S)")
_SENTENCE_BULLET_PATTERN = re.compile(r"([。！？!?；;])\s*[-*•]\s*(?=\S)")
_START_BULLET_PATTERN = re.compile(r"^([ \t]*)[-*•](?=\S)")


def _is_safe_inline_bullet_boundary(text: str, index: int) -> bool:
    if index < 0 or index >= len(text) or text[index] not in "-*•":
        return False

    cursor = index + 1
    while cursor < len(text) and text[cursor].isspace():
        cursor += 1
    if cursor >= len(text):
        return False

    next_char = text[cursor]
    if next_char.isdigit():
        return False

    if index == 0:
        return True

    prev_char = text[index - 1]
    if prev_char in "`":
        return False
    if prev_char.isascii() and prev_char.isalnum():
        return False

    return ord(next_char) > 127 or next_char in "*#>[("


def _split_bullet_run_line(line: str) -> str:
    stripped = line.strip()
    if not stripped or "`" in stripped:
        return line

    normalized = _START_BULLET_PATTERN.sub(r"\1- ", line)
    stripped = normalized.strip()
    if not stripped.startswith("- "):
        return normalized

    boundaries = [index for index, char in enumerate(stripped) if _is_safe_inline_bullet_boundary(stripped, index)]
    if len(boundaries) <= 1:
        return normalized

    items: list[str] = []
    current: list[str] = []
    for index, char in enumerate(stripped):
        if _is_safe_inline_bullet_boundary(stripped, index):
            if current:
                item = "".join(current).strip()
                if item:
                    items.append(item)
                current = []
            continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        items.append(tail)

    if len(items) <= 1:
        return normalized

    indent = normalized[: len(normalized) - len(normalized.lstrip())]
    return "\n".join(f"{indent}- {item}" for item in items)


def _normalize_segment(segment: str) -> str:
    if not segment:
        return segment

    segment = _COLON_BULLET_PATTERN.sub(r"\1\n- ", segment)
    segment = _SENTENCE_BULLET_PATTERN.sub(r"\1\n- ", segment)
    lines = [_split_bullet_run_line(line) for line in segment.splitlines()]
    return "\n".join(lines)


def normalize_assistant_markdown(text: str | None) -> str:
    raw = str(text or "")
    if not raw.strip():
        return raw

    parts = _FENCE_BLOCK_PATTERN.split(raw)
    normalized_parts = [
        part if _FENCE_BLOCK_PATTERN.fullmatch(part) else _normalize_segment(part)
        for part in parts
    ]
    return "".join(normalized_parts)
