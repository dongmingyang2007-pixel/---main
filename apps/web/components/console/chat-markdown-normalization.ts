// The backend remains the authority for persisted assistant markdown.
// The web client mirrors a narrow, idempotent subset of those repairs so
// legacy messages and in-flight stream snapshots still render coherently.

const FENCE_BLOCK_PATTERN = /(```[\s\S]*?```)/g;
const FENCE_BLOCK_EXACT_PATTERN = /^```[\s\S]*?```$/;
const DANGLING_COLON_LINE_PATTERN = /^[^\S\n]*([：:])([^\S\n]*)(.*\S)?[^\S\n]*$/;
const LEADING_PUNCTUATION_LINE_PATTERN =
  /^[^\S\n]*([，。、；：:！？）)])([^\S\n]*)(.*\S)?[^\S\n]*$/;
const LINE_ENDS_WITH_LABEL_COLON_PATTERN = /[：:][^\S\n]*$/;
const INLINE_LABEL_VALUE_PATTERN = /^[^|\n]{1,24}[：:][^\S\n]*\S/;
const TABLE_SEPARATOR_FRAGMENT_PATTERN = /^[ \t|:-]+$/;
const SENTENCE_END_PUNCTUATION_PATTERN = /[。！？.!?]$/;
const INCOMPLETE_SUFFIX_PATTERN =
  /(?:的|地|得|着|了|和|与|及|并|而|但|从|向|对|给|为|在)$/;
const CONTINUATION_START_PATTERN =
  /^(?:的|地|得|是|在|把|被|让|像|用|从|向|对|给|跟|和|与|及|并|而|但|也|又|还|都|就|才|再|更|最|太|很|超|可|能|会|要|想|有|没|不)/;
const CLOSING_QUOTE_OR_BRACKET_PATTERN = /[”’」』】）)\]"']$/;
const EMOJI_ONLY_LINE_PATTERN =
  /^[^\S\n]*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]\s*){1,3}[^\S\n]*$/u;
const DANGLING_SEPARATOR_FRAGMENT_PATTERN =
  /^[^\S\n]*[-—–]{2,}[^\S\n]*([：:])?([^\S\n]*)(.*\S)?[^\S\n]*$/;

function isSeparatorFragmentLine(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && TABLE_SEPARATOR_FRAGMENT_PATTERN.test(trimmed) && trimmed.includes("-");
}

function isStructuredMarkdownLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed) {
    return false;
  }

  return (
    isSeparatorFragmentLine(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("$$") ||
    trimmed.startsWith("- ") ||
    /^-{2,}[ \t]*\|/.test(trimmed) ||
    trimmed.startsWith("* ") ||
    trimmed.startsWith("+ ") ||
    /^[•·●▪◦‣]\s/.test(trimmed) ||
    /^[0-9]+\.\s/.test(trimmed)
  );
}

function isLikelyColonLabelLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !LINE_ENDS_WITH_LABEL_COLON_PATTERN.test(trimmed)) {
    return false;
  }

  const leading = trimmed[0];
  if (leading === "#" || leading === ">" || leading === "|" || leading === "-") {
    return false;
  }
  if ((leading === "*" || leading === "+") && !trimmed.startsWith("$")) {
    return false;
  }
  return true;
}

function isLikelyInlineLabelValueLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isStructuredMarkdownLine(trimmed)) {
    return false;
  }

  const leading = trimmed[0];
  if (leading === "#" || leading === ">" || leading === "|" || leading === "-") {
    return false;
  }
  if ((leading === "*" || leading === "+") && !trimmed.startsWith("$")) {
    return false;
  }
  return INLINE_LABEL_VALUE_PATTERN.test(trimmed);
}

function isShortHeadingLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isStructuredMarkdownLine(trimmed)) {
    return false;
  }
  if (trimmed.length > 24 || SENTENCE_END_PUNCTUATION_PATTERN.test(trimmed)) {
    return false;
  }
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(trimmed);
}

function canAttachShortFragment(previous: string, current: string): boolean {
  const previousTrimmed = previous.trim();
  const currentTrimmed = current.trim();
  if (!previousTrimmed || !currentTrimmed) {
    return false;
  }
  if (isStructuredMarkdownLine(previousTrimmed)) {
    return false;
  }
  if (LINE_ENDS_WITH_LABEL_COLON_PATTERN.test(previousTrimmed)) {
    return false;
  }
  if (SENTENCE_END_PUNCTUATION_PATTERN.test(previousTrimmed)) {
    return false;
  }
  if (!isShortHeadingLikeLine(currentTrimmed)) {
    return false;
  }

  return (
    INCOMPLETE_SUFFIX_PATTERN.test(previousTrimmed) ||
    currentTrimmed.startsWith("“") ||
    currentTrimmed.startsWith('"') ||
    currentTrimmed.startsWith("'") ||
    currentTrimmed.startsWith("（") ||
    currentTrimmed.startsWith("(") ||
    currentTrimmed.startsWith("【") ||
    currentTrimmed.startsWith("[")
  );
}

function startsWithContinuationToken(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isStructuredMarkdownLine(trimmed)) {
    return false;
  }
  return CONTINUATION_START_PATTERN.test(trimmed);
}

function findPreviousContentIndex(lines: string[]): number {
  let index = lines.length - 1;
  while (index >= 0 && !lines[index].trim()) {
    index -= 1;
  }
  return index;
}

function mergeStandaloneEmojiHeadingLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!EMOJI_ONLY_LINE_PATTERN.test(line)) {
      merged.push(line);
      index += 1;
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) {
      nextIndex += 1;
    }

    const nextLine = nextIndex < lines.length ? lines[nextIndex] : "";
    if (!isShortHeadingLikeLine(nextLine)) {
      merged.push(line);
      index += 1;
      continue;
    }

    merged.push(`${line.trim()} ${nextLine.trimStart()}`.trimEnd());
    index = nextIndex + 1;
  }

  return merged;
}

function mergeDanglingColonLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  for (const line of lines) {
    const match = line.match(DANGLING_COLON_LINE_PATTERN);
    const previousIndex = findPreviousContentIndex(merged);

    if (
      match &&
      previousIndex >= 0 &&
      merged[previousIndex].trim() &&
      !merged[previousIndex].trimEnd().endsWith(match[1])
    ) {
      const previous = merged[previousIndex].trimEnd();
      const gap = match[2] ?? "";
      const content = match[3] ?? "";
      merged[previousIndex] = `${previous}${match[1]}${gap}${content}`.trimEnd();
      merged.splice(previousIndex + 1);
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function mergeShortFragmentLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      merged.push(line);
      continue;
    }

    const previousIndex = findPreviousContentIndex(merged);
    if (previousIndex >= 0 && canAttachShortFragment(merged[previousIndex], line)) {
      merged[previousIndex] = `${merged[previousIndex].trimEnd()}${trimmed}`;
      merged.splice(previousIndex + 1);
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function mergeSeparatorFragmentLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(DANGLING_SEPARATOR_FRAGMENT_PATTERN);
    if (!match || line.includes("|")) {
      merged.push(line);
      index += 1;
      continue;
    }

    const previousIndex = findPreviousContentIndex(merged);
    if (previousIndex < 0) {
      merged.push(line);
      index += 1;
      continue;
    }

    const previous = merged[previousIndex].trimEnd();
    const punctuation = match[1] ?? "";
    const content = match[3] ?? "";

    if (punctuation || content) {
      const separator = punctuation || "：";
      const gap = content ? " " : "";
      merged[previousIndex] = `${previous}${separator}${gap}${content}`.trimEnd();
      merged.splice(previousIndex + 1);
      index += 1;
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) {
      nextIndex += 1;
    }
    const nextLine = nextIndex < lines.length ? lines[nextIndex] : "";
    if (
      nextLine &&
      (DANGLING_COLON_LINE_PATTERN.test(nextLine) ||
        LEADING_PUNCTUATION_LINE_PATTERN.test(nextLine))
    ) {
      index += 1;
      continue;
    }

    merged.push(line);
    index += 1;
  }

  return merged;
}

function mergePunctuationContinuationLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      merged.push(line);
      continue;
    }

    const previousIndex = findPreviousContentIndex(merged);
    if (previousIndex < 0) {
      merged.push(line);
      continue;
    }

    const previous = merged[previousIndex].trimEnd();
    const punctuationMatch = line.match(LEADING_PUNCTUATION_LINE_PATTERN);
    if (punctuationMatch && !isStructuredMarkdownLine(line)) {
      const punctuation = punctuationMatch[1];
      const content = punctuationMatch[3] ?? "";
      const gap = (punctuation === ":" || punctuation === "：") && content ? " " : "";
      merged[previousIndex] = `${previous}${punctuation}${gap}${content}`.trimEnd();
      merged.splice(previousIndex + 1);
      continue;
    }

    if (
      isLikelyColonLabelLine(previous) &&
      !isStructuredMarkdownLine(line) &&
      !isLikelyInlineLabelValueLine(line)
    ) {
      const separator = previous.endsWith(":") ? " " : "";
      merged[previousIndex] = `${previous}${separator}${trimmed}`.trimEnd();
      merged.splice(previousIndex + 1);
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function mergeContinuationTokenLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      merged.push(line);
      continue;
    }

    const previousIndex = findPreviousContentIndex(merged);
    if (previousIndex < 0) {
      merged.push(line);
      continue;
    }

    const previous = merged[previousIndex].trimEnd();
    const previousTrimmed = previous.trim();
    if (
      startsWithContinuationToken(trimmed) &&
      (isShortHeadingLikeLine(previousTrimmed) ||
        CLOSING_QUOTE_OR_BRACKET_PATTERN.test(previousTrimmed))
    ) {
      merged[previousIndex] = `${previous}${trimmed}`;
      merged.splice(previousIndex + 1);
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function normalizeParagraphContinuations(segment: string): string {
  return mergeContinuationTokenLines(
    mergePunctuationContinuationLines(
      mergeShortFragmentLines(
        mergeDanglingColonLines(
          mergeStandaloneEmojiHeadingLines(
            mergeSeparatorFragmentLines(segment.split("\n")),
          ),
        ),
      ),
    ),
  ).join("\n");
}

export function normalizeRenderableMarkdown(text: string): string {
  const raw = text.replace(/\r\n?/g, "\n");
  if (!raw.trim()) {
    return raw;
  }

  return raw
    .split(FENCE_BLOCK_PATTERN)
    .map((part) =>
      FENCE_BLOCK_EXACT_PATTERN.test(part)
        ? part
        : normalizeParagraphContinuations(part),
    )
    .join("");
}
