export interface VimCursor {
  lineIndex: number;
  column: number;
  preferredColumn: number;
}

export type VimMotionKey = "h" | "j" | "k" | "l" | "w" | "b" | "W" | "B" | "0" | "$" | "*" | "G";

type CharacterClass = "space" | "keyword" | "symbol" | "word";

const keywordCharacterPattern = /[0-9A-Za-z_]/;

export function createVimCursor(lines: readonly string[]): VimCursor {
  return {
    lineIndex: 0,
    column: 0,
    preferredColumn: 0
  } satisfies VimCursor;
}

export function moveVimCursor(lines: readonly string[], cursor: VimCursor, key: VimMotionKey): VimCursor {
  const normalizedLines = normalizeLines(lines);
  const safeCursor = clampCursor(normalizedLines, cursor);

  switch (key) {
    case "h":
      return setColumn(normalizedLines, safeCursor, safeCursor.column - 1);
    case "j":
      return moveVertically(normalizedLines, safeCursor, 1);
    case "k":
      return moveVertically(normalizedLines, safeCursor, -1);
    case "l":
      return setColumn(normalizedLines, safeCursor, safeCursor.column + 1);
    case "0":
      return setColumn(normalizedLines, safeCursor, 0);
    case "$":
      return setColumn(normalizedLines, safeCursor, getMaxColumn(getLineAt(normalizedLines, safeCursor.lineIndex)));
    case "w":
      return moveToNextToken(normalizedLines, safeCursor, false);
    case "b":
      return moveToPreviousToken(normalizedLines, safeCursor, false);
    case "W":
      return moveToNextToken(normalizedLines, safeCursor, true);
    case "B":
      return moveToPreviousToken(normalizedLines, safeCursor, true);
    case "*":
      return moveToNextSearchMatch(normalizedLines, safeCursor);
    case "G":
      return moveVimCursorToLine(normalizedLines, safeCursor, normalizedLines.length - 1);
    default:
      return safeCursor;
  }
}

export function moveVimCursorByLines(lines: readonly string[], cursor: VimCursor, delta: number): VimCursor {
  return moveVertically(normalizeLines(lines), clampCursor(normalizeLines(lines), cursor), delta);
}

export function moveVimCursorToLine(lines: readonly string[], cursor: VimCursor, lineIndex: number): VimCursor {
  const normalizedLines = normalizeLines(lines);
  const safeCursor = clampCursor(normalizedLines, cursor);
  const nextLineIndex = clampNumber(lineIndex, 0, normalizedLines.length - 1);
  const nextColumn = clampNumber(safeCursor.preferredColumn, 0, getMaxColumn(getLineAt(normalizedLines, nextLineIndex)));

  return {
    lineIndex: nextLineIndex,
    column: nextColumn,
    preferredColumn: safeCursor.preferredColumn
  } satisfies VimCursor;
}

function moveVertically(lines: readonly string[], cursor: VimCursor, delta: number): VimCursor {
  const nextLineIndex = clampNumber(cursor.lineIndex + delta, 0, lines.length - 1);
  if (nextLineIndex === cursor.lineIndex) {
    return cursor;
  }

  const nextColumn = clampNumber(cursor.preferredColumn, 0, getMaxColumn(getLineAt(lines, nextLineIndex)));
  return {
    lineIndex: nextLineIndex,
    column: nextColumn,
    preferredColumn: cursor.preferredColumn
  } satisfies VimCursor;
}

function moveToNextToken(lines: readonly string[], cursor: VimCursor, bigWord: boolean): VimCursor {
  const documentText = joinLines(lines);
  const offset = toOffset(lines, cursor);
  let index = offset;

  if (index >= documentText.length) {
    return cursor;
  }

  if (classifyCharacter(documentText[index], bigWord) === "space") {
    index = skipForwardWhile(documentText, index, (character) => classifyCharacter(character, bigWord) === "space");
  } else {
    const currentClass = classifyCharacter(documentText[index], bigWord);
    index = skipForwardWhile(documentText, index, (character) => classifyCharacter(character, bigWord) === currentClass);
    index = skipForwardWhile(documentText, index, (character) => classifyCharacter(character, bigWord) === "space");
  }

  if (index >= documentText.length) {
    return cursor;
  }

  return fromOffset(lines, index);
}

function moveToPreviousToken(lines: readonly string[], cursor: VimCursor, bigWord: boolean): VimCursor {
  const documentText = joinLines(lines);
  const offset = toOffset(lines, cursor);
  if (offset === 0) {
    return cursor;
  }

  let index = offset - 1;
  while (index > 0 && classifyCharacter(documentText[index], bigWord) === "space") {
    index -= 1;
  }

  const currentClass = classifyCharacter(documentText[index], bigWord);
  while (index > 0 && classifyCharacter(documentText[index - 1], bigWord) === currentClass) {
    index -= 1;
  }

  return fromOffset(lines, index);
}

function moveToNextSearchMatch(lines: readonly string[], cursor: VimCursor): VimCursor {
  const currentLine = getLineAt(lines, cursor.lineIndex);
  const token = getSearchToken(currentLine, cursor.column);
  if (!token) {
    return cursor;
  }

  const documentText = joinLines(lines);
  const startOffset = toOffset(lines, cursor) + 1;
  const tokenClass = classifyCharacter(token[0], false);
  if (tokenClass === "space") {
    return cursor;
  }
  const matchOffset =
    findToken(documentText, token, startOffset, tokenClass)
    ?? findToken(documentText, token, 0, tokenClass);

  if (matchOffset === undefined) {
    return cursor;
  }

  return fromOffset(lines, matchOffset);
}

function getSearchToken(line: string, column: number): string | null {
  if (column >= line.length) {
    return null;
  }

  const tokenClass = classifyCharacter(line[column], false);
  if (tokenClass === "space") {
    return null;
  }

  let start = column;
  while (start > 0 && classifyCharacter(line[start - 1], false) === tokenClass) {
    start -= 1;
  }

  let end = column + 1;
  while (end < line.length && classifyCharacter(line[end], false) === tokenClass) {
    end += 1;
  }

  return line.slice(start, end);
}

function findToken(
  documentText: string,
  token: string,
  startOffset: number,
  tokenClass: Exclude<CharacterClass, "space">
): number | undefined {
  let index = startOffset;
  while (index < documentText.length) {
    const matchOffset = documentText.indexOf(token, index);
    if (matchOffset < 0) {
      return undefined;
    }

    if (isTokenBoundary(documentText, matchOffset, token.length, tokenClass)) {
      return matchOffset;
    }

    index = matchOffset + 1;
  }

  return undefined;
}

function isTokenBoundary(
  documentText: string,
  start: number,
  tokenLength: number,
  tokenClass: Exclude<CharacterClass, "space">
): boolean {
  if (tokenClass === "keyword") {
    const before = start > 0 ? documentText[start - 1] : null;
    const after = start + tokenLength < documentText.length ? documentText[start + tokenLength] : null;
    return !isKeywordCharacter(before) && !isKeywordCharacter(after);
  }

  return true;
}

function setColumn(lines: readonly string[], cursor: VimCursor, nextColumn: number): VimCursor {
  const clampedColumn = clampNumber(nextColumn, 0, getMaxColumn(getLineAt(lines, cursor.lineIndex)));
  return {
    lineIndex: cursor.lineIndex,
    column: clampedColumn,
    preferredColumn: clampedColumn
  } satisfies VimCursor;
}

function clampCursor(lines: readonly string[], cursor: VimCursor): VimCursor {
  const lineIndex = clampNumber(cursor.lineIndex, 0, lines.length - 1);
  const line = getLineAt(lines, lineIndex);
  const column = clampNumber(cursor.column, 0, getMaxColumn(line));
  const preferredColumn = Math.max(0, cursor.preferredColumn);
  return {
    lineIndex,
    column,
    preferredColumn
  } satisfies VimCursor;
}

function fromOffset(lines: readonly string[], offset: number): VimCursor {
  let runningOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = getLineAt(lines, index);
    const nextRunningOffset = runningOffset + line.length;
    if (offset <= nextRunningOffset - 1 || index === lines.length - 1) {
      const column = clampNumber(offset - runningOffset, 0, getMaxColumn(line));
      return {
        lineIndex: index,
        column,
        preferredColumn: column
      } satisfies VimCursor;
    }
    runningOffset = nextRunningOffset + 1;
  }

  return createVimCursor(lines);
}

function toOffset(lines: readonly string[], cursor: VimCursor): number {
  let offset = 0;
  for (let index = 0; index < cursor.lineIndex; index += 1) {
    offset += getLineAt(lines, index).length + 1;
  }
  return offset + cursor.column;
}

function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function normalizeLines(lines: readonly string[]): string[] {
  return lines.length > 0 ? lines.map((line) => (line.length > 0 ? line : " ")) : [" "];
}

function getMaxColumn(line: string): number {
  return Math.max(0, line.length - 1);
}

function skipForwardWhile(documentText: string, startOffset: number, predicate: (character: string) => boolean): number {
  let index = startOffset;
  while (index < documentText.length && predicate(documentText[index] ?? "")) {
    index += 1;
  }
  return index;
}

function getLineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? " ";
}

function classifyCharacter(character: string | null | undefined, bigWord: boolean): CharacterClass {
  if (!character || character === "\n" || character === "\r" || character === "\t" || character === " ") {
    return "space";
  }

  if (bigWord) {
    return "word";
  }

  return isKeywordCharacter(character) ? "keyword" : "symbol";
}

function isKeywordCharacter(character: string | null | undefined): boolean {
  return Boolean(character && keywordCharacterPattern.test(character));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
