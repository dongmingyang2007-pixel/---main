from __future__ import annotations

import re

_FENCE_BLOCK_PATTERN = re.compile(r"(```[\s\S]*?```)")
_MATH_BLOCK_GLUE_PATTERN = re.compile(
    r"(\$\$[^$]{1,800})\${3,4}(?=(?:\\|[A-Za-z([{]))"
)
_MATH_AFTER_COLON_PATTERN = re.compile(r"([：:])\s*(\$\$)(?=(?:\\|[A-Za-z([{]))")
_DANGLING_COLON_LINE_PATTERN = re.compile(r"^[^\S\n]*([：:])([^\S\n]*)(.*\S)?[^\S\n]*$")
_LEADING_PUNCTUATION_LINE_PATTERN = re.compile(
    r"^[^\S\n]*([，。、；：:！？）)])([^\S\n]*)(.*\S)?[^\S\n]*$"
)
_LINE_ENDS_WITH_LABEL_COLON_PATTERN = re.compile(r"[：:][^\S\n]*$")
_INLINE_LABEL_VALUE_PATTERN = re.compile(r"^[^|\n]{1,24}[：:][^\S\n]*\S")
_INLINE_HEADING_GLUE_PATTERN = re.compile(
    r"([^\s#])[^\S\n]*(#{2,6})(?=[^\S\n]*[0-9A-Za-z\u4e00-\u9fff([{(（【])"
)
_HEADING_WITHOUT_SPACE_PATTERN = re.compile(
    r"(?m)^([^\S\n]*#{1,6})(?=[0-9A-Za-z\u4e00-\u9fff([{(（【])"
)
_HEADING_ORDERED_LIST_GLUE_PATTERN = re.compile(
    r"([\u4e00-\u9fffA-Za-z）)】])(\d+\.\s+)"
)
_SENTENCE_ORDERED_LIST_PATTERN = re.compile(r"([。！？；：:])\s+(\d+\.\s+)")
_BROKEN_BLOCKQUOTE_PATTERN = re.compile(r"(^|\n)[^\S\n]*\*+[^\S\n]*>[^\S\n]*", re.MULTILINE)
_BROKEN_STAR_LABEL_PATTERN = re.compile(
    r"(^|\n)([^\S\n]*)\*(?=[^\s*>\n])(?=[^\n]*[：:])",
    re.MULTILINE,
)
_UNICODE_BULLET_PATTERN = re.compile(r"(^|\n)([^\S\n]*)[•·●▪◦‣][^\S\n]*", re.MULTILINE)
_DANGLING_SEPARATOR_FRAGMENT_PATTERN = re.compile(
    r"^[^\S\n]*[-—–]{2,}[^\S\n]*([：:])?([^\S\n]*)(.*\S)?[^\S\n]*$"
)
_DISPLAY_MATH_PATTERN = re.compile(r"\$\$([\s\S]*?)\$\$")
_INLINE_MATH_PATTERN = re.compile(r"(?<!\$)\$([^$\n]+?)\$(?!\$)")
_HEADING_TABLE_GLUE_PATTERN = re.compile(
    r"(^|\n)([ \t]*#{1,6}[^\n|]+?)\|(?=[^\n]*\|[ \t]*:?-{3,}:?)"
)
_PROSE_TABLE_GLUE_PATTERN = re.compile(r"([。！？；：:])(\|(?=[^\n|]+\|[^\n|]+\|))")
_TABLE_SEPARATOR_ROW_PATTERN = re.compile(
    r"^[ \t]*\|?(?:[ \t]*:?-{2,}:?[ \t]*\|){2,}[ \t]*:?-{2,}:?[ \t]*\|?[ \t]*$"
)
_TABLE_SEPARATOR_FRAGMENT_PATTERN = re.compile(r"^[ \t|:-]+$")
_EMBEDDED_TABLE_SEPARATOR_PATTERN = re.compile(
    r"(\|?[ \t]*:?-{2,}:?(?:[ \t]*\|[ \t]*:?-{2,}:?){1,}[ \t]*\|?)"
)
_SENTENCE_END_PUNCTUATION_PATTERN = re.compile(r"[。！？.!?]$")
_INCOMPLETE_SUFFIX_PATTERN = re.compile(
    r"(?:的|地|得|着|了|和|与|及|并|而|但|从|向|对|给|为|在)$"
)
_CONTINUATION_START_PATTERN = re.compile(
    r"^(?:的|地|得|是|在|把|被|让|像|用|从|向|对|给|跟|和|与|及|并|而|但|也|又|还|都|就|才|再|更|最|太|很|超|可|能|会|要|想|有|没|不)"
)
_CLOSING_QUOTE_OR_BRACKET_PATTERN = re.compile(r"[”’」』】）)\]\"']$")
_START_BULLET_PATTERN = re.compile(r"^([ \t]*)[-*•](?=\S)")
_EMOJI_ONLY_LINE_PATTERN = re.compile(
    r"^[^\S\n]*(?:[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]\s*){1,3}[^\S\n]*$"
)
_COLON_BULLET_PATTERN = re.compile(r"([：:])\s*[-*•·●▪◦‣]\s*(?=\S)")
_SENTENCE_BULLET_PATTERN = re.compile(r"([。！？!?；;])\s*[-*•·●▪◦‣]\s*(?=\S)")

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
    "leftarrow",
    "rightarrow",
    "Leftarrow",
    "Rightarrow",
    "leftrightarrow",
    "Leftrightarrow",
    "mapsto",
    "implies",
    "iff",
    "to",
    "times",
    "cdot",
    "ast",
    "star",
    "pm",
    "mp",
    "neq",
    "le",
    "leq",
    "ge",
    "geq",
    "ll",
    "gg",
    "sim",
    "simeq",
    "approx",
    "propto",
    "in",
    "notin",
    "ni",
    "subset",
    "subseteq",
    "supset",
    "supseteq",
    "cup",
    "cap",
    "land",
    "lor",
    "sum",
    "prod",
    "coprod",
    "int",
    "iint",
    "iiint",
    "oint",
    "limsup",
    "liminf",
    "lim",
    "sup",
    "inf",
    "max",
    "min",
    "argmax",
    "argmin",
    "det",
    "dim",
    "sin",
    "cos",
    "tan",
    "cot",
    "sec",
    "csc",
    "sinh",
    "cosh",
    "tanh",
    "ln",
    "log",
    "exp",
    "Pr",
    "mathrm",
    "mathbf",
    "mathbb",
    "mathcal",
    "mathfrak",
    "mathit",
    "mathsf",
    "mathtt",
)
_TERMINAL_MATH_COMMAND_PATTERN = re.compile(
    r"\\(?:"
    + "|".join(sorted(set(_TERMINAL_MATH_COMMANDS), key=len, reverse=True))
    + r")(?=[A-Za-z0-9])"
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
    if prev_char == "`":
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

    boundaries = [
        index
        for index, _char in enumerate(stripped)
        if _is_safe_inline_bullet_boundary(stripped, index)
    ]
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


def _is_separator_fragment_line(line: str) -> bool:
    trimmed = line.strip()
    return bool(trimmed) and bool(_TABLE_SEPARATOR_FRAGMENT_PATTERN.match(trimmed)) and "-" in trimmed


def _is_structured_markdown_line(line: str) -> bool:
    trimmed = line.lstrip()
    if not trimmed:
        return False

    return (
        _is_separator_fragment_line(trimmed)
        or trimmed.startswith("#")
        or trimmed.startswith(">")
        or trimmed.startswith("|")
        or trimmed.startswith("```")
        or trimmed.startswith("$$")
        or trimmed.startswith("- ")
        or bool(re.match(r"^-{2,}[ \t]*\|", trimmed))
        or trimmed.startswith("* ")
        or trimmed.startswith("+ ")
        or bool(re.match(r"^[•·●▪◦‣]\s", trimmed))
        or bool(re.match(r"^[0-9]+\.\s", trimmed))
    )


def _is_likely_colon_label_line(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or not _LINE_ENDS_WITH_LABEL_COLON_PATTERN.search(trimmed):
        return False

    leading = trimmed[0]
    if leading in {"#", ">", "|", "-"}:
        return False
    if leading in {"*", "+"} and not trimmed.startswith("$"):
        return False
    return True


def _is_likely_inline_label_value_line(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or _is_structured_markdown_line(trimmed):
        return False

    leading = trimmed[0]
    if leading in {"#", ">", "|", "-"}:
        return False
    if leading in {"*", "+"} and not trimmed.startswith("$"):
        return False
    return bool(_INLINE_LABEL_VALUE_PATTERN.match(trimmed))


def _is_short_heading_like_line(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or _is_structured_markdown_line(trimmed):
        return False
    if len(trimmed) > 24 or _SENTENCE_END_PUNCTUATION_PATTERN.search(trimmed):
        return False
    return bool(re.search(r"[A-Za-z0-9\u4e00-\u9fff]", trimmed))


def _can_attach_short_fragment(previous: str, current: str) -> bool:
    previous_trimmed = previous.strip()
    current_trimmed = current.strip()
    if not previous_trimmed or not current_trimmed:
        return False
    if _is_structured_markdown_line(previous_trimmed):
        return False
    if _LINE_ENDS_WITH_LABEL_COLON_PATTERN.search(previous_trimmed):
        return False
    if _SENTENCE_END_PUNCTUATION_PATTERN.search(previous_trimmed):
        return False
    if not _is_short_heading_like_line(current_trimmed):
        return False

    return bool(_INCOMPLETE_SUFFIX_PATTERN.search(previous_trimmed)) or current_trimmed.startswith(
        ("“", '"', "'", "（", "(", "【", "[")
    )


def _starts_with_continuation_token(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed or _is_structured_markdown_line(trimmed):
        return False
    return bool(_CONTINUATION_START_PATTERN.match(trimmed))


def _merge_standalone_emoji_heading_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not _EMOJI_ONLY_LINE_PATTERN.match(line):
            merged.append(line)
            index += 1
            continue

        next_content_index = index + 1
        while next_content_index < len(lines) and not lines[next_content_index].strip():
            next_content_index += 1

        next_line = lines[next_content_index] if next_content_index < len(lines) else ""
        if not _is_short_heading_like_line(next_line):
            merged.append(line)
            index += 1
            continue

        merged.append(f"{line.strip()} {next_line.lstrip()}".rstrip())
        index = next_content_index + 1

    return merged


def _merge_dangling_colon_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    for line in lines:
        match = _DANGLING_COLON_LINE_PATTERN.match(line)
        previous_content_index = len(merged) - 1
        while previous_content_index >= 0 and not merged[previous_content_index].strip():
            previous_content_index -= 1

        if (
            match
            and previous_content_index >= 0
            and merged[previous_content_index].strip()
            and not merged[previous_content_index].rstrip().endswith(match.group(1))
        ):
            previous = merged[previous_content_index].rstrip()
            gap = match.group(2) or ""
            content = match.group(3) or ""
            merged[previous_content_index] = f"{previous}{match.group(1)}{gap}{content}".rstrip()
            del merged[previous_content_index + 1 :]
            continue
        merged.append(line)

    return merged


def _merge_short_fragment_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            merged.append(line)
            continue

        previous_content_index = len(merged) - 1
        while previous_content_index >= 0 and not merged[previous_content_index].strip():
            previous_content_index -= 1

        if (
            previous_content_index >= 0
            and _can_attach_short_fragment(merged[previous_content_index], line)
        ):
            merged[previous_content_index] = (
                f"{merged[previous_content_index].rstrip()}{trimmed}"
            )
            del merged[previous_content_index + 1 :]
            continue

        merged.append(line)

    return merged


def _merge_separator_fragment_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = _DANGLING_SEPARATOR_FRAGMENT_PATTERN.match(line)
        if not match or "|" in line:
            merged.append(line)
            index += 1
            continue

        previous_content_index = len(merged) - 1
        while previous_content_index >= 0 and not merged[previous_content_index].strip():
            previous_content_index -= 1

        if previous_content_index < 0:
            merged.append(line)
            index += 1
            continue

        previous = merged[previous_content_index].rstrip()
        punctuation = match.group(1) or ""
        content = match.group(3) or ""

        if punctuation or content:
            separator = punctuation or "："
            gap = " " if content else ""
            merged[previous_content_index] = f"{previous}{separator}{gap}{content}".rstrip()
            del merged[previous_content_index + 1 :]
            index += 1
            continue

        next_content_index = index + 1
        while next_content_index < len(lines) and not lines[next_content_index].strip():
            next_content_index += 1
        next_line = lines[next_content_index] if next_content_index < len(lines) else ""
        if next_line and (
            _DANGLING_COLON_LINE_PATTERN.match(next_line)
            or _LEADING_PUNCTUATION_LINE_PATTERN.match(next_line)
        ):
            index += 1
            continue

        merged.append(line)
        index += 1

    return merged


def _merge_punctuation_continuation_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            merged.append(line)
            continue

        previous_content_index = len(merged) - 1
        while previous_content_index >= 0 and not merged[previous_content_index].strip():
            previous_content_index -= 1

        if previous_content_index < 0:
            merged.append(line)
            continue

        previous = merged[previous_content_index].rstrip()
        punctuation_match = _LEADING_PUNCTUATION_LINE_PATTERN.match(line)
        if punctuation_match and not _is_structured_markdown_line(line):
            punctuation = punctuation_match.group(1)
            content = punctuation_match.group(3) or ""
            gap = " " if punctuation in {":", "："} and content else ""
            merged[previous_content_index] = f"{previous}{punctuation}{gap}{content}".rstrip()
            del merged[previous_content_index + 1 :]
            continue

        if (
            _is_likely_colon_label_line(previous)
            and not _is_structured_markdown_line(line)
            and not _is_likely_inline_label_value_line(line)
        ):
            separator = " " if previous.endswith(":") else ""
            merged[previous_content_index] = f"{previous}{separator}{trimmed}".rstrip()
            del merged[previous_content_index + 1 :]
            continue

        merged.append(line)

    return merged


def _merge_continuation_token_lines(lines: list[str]) -> list[str]:
    if not lines:
        return lines

    merged: list[str] = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            merged.append(line)
            continue

        previous_content_index = len(merged) - 1
        while previous_content_index >= 0 and not merged[previous_content_index].strip():
            previous_content_index -= 1

        if previous_content_index < 0:
            merged.append(line)
            continue

        previous = merged[previous_content_index].rstrip()
        previous_trimmed = previous.strip()
        if (
            _starts_with_continuation_token(trimmed)
            and (
                _is_short_heading_like_line(previous_trimmed)
                or bool(_CLOSING_QUOTE_OR_BRACKET_PATTERN.search(previous_trimmed))
            )
        ):
            merged[previous_content_index] = f"{previous}{trimmed}"
            del merged[previous_content_index + 1 :]
            continue

        merged.append(line)

    return merged


def _normalize_paragraph_continuations(segment: str) -> str:
    return "\n".join(
        _merge_continuation_token_lines(
            _merge_punctuation_continuation_lines(
                _merge_short_fragment_lines(
                    _merge_dangling_colon_lines(
                        _merge_standalone_emoji_heading_lines(
                            _merge_separator_fragment_lines(segment.split("\n"))
                        )
                    )
                )
            )
        )
    )


def _normalize_math_rendering_line(line: str) -> str:
    if "$$" not in line:
        return line
    return _MATH_AFTER_COLON_PATTERN.sub(
        r"\1\n\2",
        _MATH_BLOCK_GLUE_PATTERN.sub(lambda match: f"{match.group(1)}$$\n$$", line),
    )


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
    return _HEADING_WITHOUT_SPACE_PATTERN.sub(
        r"\1 ",
        _INLINE_HEADING_GLUE_PATTERN.sub(r"\1\n\2", segment),
    )


def _normalize_list_and_quote_markers(segment: str) -> str:
    segment = _BROKEN_BLOCKQUOTE_PATTERN.sub(r"\1> ", segment)
    segment = _BROKEN_STAR_LABEL_PATTERN.sub(r"\1\2", segment)
    segment = _UNICODE_BULLET_PATTERN.sub(r"\1\2- ", segment)
    segment = _HEADING_ORDERED_LIST_GLUE_PATTERN.sub(r"\1\n\2", segment)
    return _SENTENCE_ORDERED_LIST_PATTERN.sub(r"\1\n\2", segment)


def _ensure_table_row_pipes(row: str) -> str:
    normalized = row.strip()
    if not normalized.startswith("|"):
        normalized = f"|{normalized}"
    if not normalized.endswith("|"):
        normalized = f"{normalized}|"
    return normalized


def _sanitize_compact_table_fragment(line: str) -> str:
    normalized = line.strip()
    if not normalized:
        return normalized
    if _is_separator_fragment_line(normalized):
        normalized = re.sub(r"\s+", "", normalized)
    return normalized


def _split_embedded_table_rows(fragment: str) -> list[str]:
    pending = [fragment.strip()]
    rows: list[str] = []

    while pending:
        current = pending.pop(0).strip()
        if not current:
            continue
        if _TABLE_SEPARATOR_ROW_PATTERN.match(current):
            rows.append(_ensure_table_row_pipes(current))
            continue

        separator_match = _EMBEDDED_TABLE_SEPARATOR_PATTERN.search(current)
        if separator_match and separator_match.start() is not None:
            before = current[: separator_match.start()].strip()
            separator = separator_match.group(1).strip()
            after = current[separator_match.end() :].strip()
            if before:
                rows.append(before)
            rows.append(_ensure_table_row_pipes(separator))
            if after:
                pending.insert(0, after)
            continue

        rows.append(current)

    return rows


def _normalize_compact_table_block(lines: list[str]) -> str:
    fragments = [
        fragment
        for fragment in (_sanitize_compact_table_fragment(line) for line in lines if line.strip())
        if fragment
    ]
    compact_line = "".join(fragments)
    if "|" not in compact_line:
        return "\n".join(lines)

    rows = [
        _ensure_table_row_pipes(row)
        for row in (
            row.strip()
            for fragment in compact_line.split("||")
            if fragment.strip()
            for row in _split_embedded_table_rows(fragment)
        )
        if row
    ]
    if len(rows) < 3 or not any(_TABLE_SEPARATOR_ROW_PATTERN.match(row) for row in rows):
        return "\n".join(lines)
    return "\n".join(rows)


def _normalize_table_line(line: str) -> str:
    if "|" not in line or "||" not in line or not re.search(r"-{2,}", line):
        return line

    rows = [_ensure_table_row_pipes(row) for row in line.split("||") if row.strip()]
    if len(rows) < 2 or not any(_TABLE_SEPARATOR_ROW_PATTERN.match(row) for row in rows):
        return line
    return "\n".join(rows)


def _normalize_markdown_tables(segment: str) -> str:
    lines = _PROSE_TABLE_GLUE_PATTERN.sub(
        r"\1\n\2",
        _HEADING_TABLE_GLUE_PATTERN.sub(r"\1\2\n|", segment),
    ).split("\n")
    normalized: list[str] = []
    index = 0

    while index < len(lines):
        current = lines[index]
        has_pipe = current.count("|") >= 2
        if not has_pipe and not _is_separator_fragment_line(current):
            normalized.append(current)
            index += 1
            continue

        block = [current]
        cursor = index + 1
        while cursor < len(lines):
            next_line = lines[cursor]
            next_has_pipe = next_line.count("|") >= 2
            if not next_line.strip() or next_has_pipe or _is_separator_fragment_line(next_line):
                block.append(next_line)
                cursor += 1
                continue
            break

        normalized.append(_normalize_compact_table_block(block))
        index = cursor

    return "\n".join(_normalize_table_line(line) for line in "\n".join(normalized).split("\n"))


def _normalize_segment(segment: str) -> str:
    if not segment:
        return segment

    merged_lines = _normalize_paragraph_continuations(
        "\n".join(_normalize_math_rendering_line(line) for line in segment.split("\n"))
    )
    normalized = _normalize_markdown_tables(
        _normalize_list_and_quote_markers(
            _normalize_heading_markers(_normalize_math_expressions(merged_lines))
        )
    )
    normalized = _COLON_BULLET_PATTERN.sub(r"\1\n- ", normalized)
    normalized = _SENTENCE_BULLET_PATTERN.sub(r"\1\n- ", normalized)
    normalized = _normalize_paragraph_continuations(normalized)
    return "\n".join(_split_bullet_run_line(line) for line in normalized.split("\n"))


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
