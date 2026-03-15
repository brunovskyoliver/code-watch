import { describe, expect, it } from "vitest";
import { createVimCursor, moveVimCursor } from "@renderer/lib/vim-motions";

describe("vim-motions", () => {
  it("moves by lowercase word boundaries across punctuation", () => {
    const lines = ["+const foo.bar = baz"];
    let cursor = createVimCursor(lines);

    cursor = moveVimCursor(lines, cursor, "w");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 1 });

    cursor = moveVimCursor(lines, cursor, "w");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 7 });

    cursor = moveVimCursor(lines, cursor, "w");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 10 });

    cursor = moveVimCursor(lines, cursor, "w");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 11 });
  });

  it("moves by WORD boundaries across lines", () => {
    const lines = ["-const foo", "+  next token"];
    let cursor = createVimCursor(lines);

    cursor = moveVimCursor(lines, cursor, "W");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 7 });

    cursor = moveVimCursor(lines, cursor, "W");
    expect(cursor).toMatchObject({ lineIndex: 1, column: 0 });

    cursor = moveVimCursor(lines, cursor, "W");
    expect(cursor).toMatchObject({ lineIndex: 1, column: 3 });

    cursor = moveVimCursor(lines, cursor, "B");
    expect(cursor).toMatchObject({ lineIndex: 1, column: 0 });
  });

  it("keeps the preferred column when moving vertically", () => {
    const lines = ["+alpha beta gamma", "+tiny", "+another line"];
    const firstLine = lines[0]!;
    const secondLine = lines[1]!;
    const thirdLine = lines[2]!;
    let cursor = createVimCursor(lines);

    cursor = moveVimCursor(lines, cursor, "$");
    cursor = moveVimCursor(lines, cursor, "k");
    expect(cursor).toMatchObject({ lineIndex: 0, column: firstLine.length - 1 });

    cursor = moveVimCursor(lines, cursor, "j");
    expect(cursor).toMatchObject({ lineIndex: 1, column: secondLine.length - 1, preferredColumn: firstLine.length - 1 });

    cursor = moveVimCursor(lines, cursor, "j");
    expect(cursor).toMatchObject({ lineIndex: 2, column: thirdLine.length - 1, preferredColumn: firstLine.length - 1 });
  });

  it("jumps to line bounds", () => {
    const lines = ["+trim me"];
    const onlyLine = lines[0]!;
    let cursor = createVimCursor(lines);

    cursor = moveVimCursor(lines, cursor, "$");
    expect(cursor).toMatchObject({ lineIndex: 0, column: onlyLine.length - 1 });

    cursor = moveVimCursor(lines, cursor, "0");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 0 });
  });

  it("searches the next occurrence of the token under the cursor and wraps", () => {
    const lines = ["+const value = foo", "+return foo + value"];
    let cursor = createVimCursor(lines);

    cursor = moveVimCursor(lines, cursor, "w");
    cursor = moveVimCursor(lines, cursor, "w");
    cursor = moveVimCursor(lines, cursor, "w");
    cursor = moveVimCursor(lines, cursor, "w");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 15 });

    cursor = moveVimCursor(lines, cursor, "*");
    expect(cursor).toMatchObject({ lineIndex: 1, column: 8 });

    cursor = moveVimCursor(lines, cursor, "*");
    expect(cursor).toMatchObject({ lineIndex: 0, column: 15 });
  });
});
