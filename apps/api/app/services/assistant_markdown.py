from __future__ import annotations

import re

_FENCE_BLOCK_PATTERN = re.compile(r"(```[\s\S]*?```)")
_COLON_BULLET_PATTERN = re.compile(r"([：:])\s*[-*•]\s*(?=\S)")
_SENTENCE_BULLET_PATTERN = re.compile(r"([。！？!?；;])\s*[-*•]\s*(?=\S)")
_START_BULLET_PATTERN = re.compile(r"^([ \t]*)[-*•](?=\S)")
_DANGLING_COLON_LINE_PATTERN = re.compile(r"^[ \t]*([：:])([ \t]*)(.*\S)?[ \t]*$")
_INLINE_HEADING_GLUE_PATTERN = re.compile(r"([^\s#])[ \t]*(#{2,6})(?=[ \t]*[0-9A-Za-z\u4e00-\u9fff([{(（【])")
_HEADING_WITHOUT_SPACE_PATTERN = re.compile(r"(?m)^([ \t]*#{1,6})(?=[0-9A-Za-z\u4e00-\u9fff([{(（【])")
_DISPLAY_MATH_PATTERN = re.compile(r"\$\$([\s\S]*?)\$\$")
_INLINE_MATH_PATTERN = re.compile(r"(?<!\$)\$([^$\n]+?)\$(?!\$)")
_HEADING_TABLE_GLUE_PATTERN = re.compile(r"(^|\n)([ \t]*#{1,6}[^\n|]+?)\|(?=[^\n]*\|[ \t]*:?-{3,}:?)")
_TABLE_SEPARATOR_ROW_PATTERN = re.compile(
    r"^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|){2,}[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$"
)
_TERMINAL_MATH_COMMANDS = (
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "varepsilon",
    "zeta",
    "eta",
    "theta",
    "vartheta",
    "iota",
    "kappa",
    "lambda",
    "mu",
    "nu",
    "xi",
    "pi",
    "varpi",
    "rho",
    "varrho",
    "sigma",
    "varsigma",
    "tau",
    "upsilon",
    "phi",
    "varphi",
    "chi",
    "psi",
    "omega",
    "Gamma",
    "Delta",
    "Theta",
    "Lambda",
    "Xi",
    "Pi",
    "Sigma",
    "Upsilon",
    "Phi",
    "Psi",
    "Omega",
    "partial",
    "nabla",
    "hbar",
    "ell",
    "infty",
    "imath",
    "jmath",
)
_TERMINAL_MATH_COMMAND_PATTERN = re.compile(
    r"\\(?:" + "|".join(_TERMINAL_MATH_COMMANDS) + r")(?=[A-Za-z0-9])"
)


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


def _merge_dangling_colon_lines(segment: str) -> str:
    lines = segment.splitlines()
    if not lines:
        return segment

    merged: list[str] = []
    for line in lines:
        match = _DANGLING_COLON_LINE_PATTERN.match(line)
        if (
            match
            and merged
            and merged[-1].strip()
            and not merged[-1].rstrip().endswith(("：", ":"))
        ):
            colon = match.group(1)
            gap = match.group(2) or ""
            content = match.group(3) or ""
            previous = merged.pop().rstrip()
            merged.append(f"{previous}{colon}{gap}{content}".rstrip())
            continue
        merged.append(line)

    return "\n".join(merged)


def _normalize_math_body(body: str) -> str:
    if "\\" not in body:
        return body
    return _TERMINAL_MATH_COMMAND_PATTERN.sub(lambda match: f"{match.group(0)} ", body)


def _normalize_math_expressions(segment: str) -> str:
    segment = _DISPLAY_MATH_PATTERN.sub(
        lambda match: f"$${_normalize_math_body(match.group(1))}$$",
        segment,
    )
    return _INLINE_MATH_PATTERN.sub(
        lambda match: f"${_normalize_math_body(match.group(1))}$",
        segment,
    )


def _normalize_heading_markers(segment: str) -> str:
    segment = _INLINE_HEADING_GLUE_PATTERN.sub(r"\1\n\2", segment)
    return _HEADING_WITHOUT_SPACE_PATTERN.sub(r"\1 ", segment)


def _ensure_table_row_pipes(row: str) -> str:
    normalized = row.strip()
    if not normalized.startswith("|"):
        normalized = f"|{normalized}"
    if not normalized.endswith("|"):
        normalized = f"{normalized}|"
    return normalized


def _normalize_table_line(line: str) -> str:
    if "|" not in line or "||" not in line or "---" not in line:
        return line

    rows = [_ensure_table_row_pipes(row) for row in line.split("||") if row.strip()]
    if len(rows) < 2 or not any(_TABLE_SEPARATOR_ROW_PATTERN.match(row) for row in rows):
        return line
    return "\n".join(rows)


def _normalize_markdown_tables(segment: str) -> str:
    segment = _HEADING_TABLE_GLUE_PATTERN.sub(lambda match: f"{match.group(1)}{match.group(2)}\n|", segment)
    return "\n".join(_normalize_table_line(line) for line in segment.splitlines())


def _normalize_segment(segment: str) -> str:
    if not segment:
        return segment

    segment = _merge_dangling_colon_lines(segment)
    segment = _normalize_math_expressions(segment)
    segment = _normalize_heading_markers(segment)
    segment = _normalize_markdown_tables(segment)
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
