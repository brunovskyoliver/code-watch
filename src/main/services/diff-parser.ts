import { hashLine } from "@main/services/utils";
import type { FileDiff, FileStatus } from "@shared/types";

interface ParseDiffOptions {
  filePath: string;
  oldPath: string | null;
  newPath: string | null;
  status: FileStatus;
  additions: number | null;
  deletions: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(diffText: string, options: ParseDiffOptions): FileDiff {
  const normalized = diffText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const hunks: FileDiff["hunks"] = [];
  let currentHunk: FileDiff["hunks"][number] | null = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let oldPath = options.oldPath;
  let newPath = options.newPath;
  let binary = false;

  for (const rawLine of lines) {
    if (rawLine.startsWith("Binary files") || rawLine.startsWith("GIT binary patch")) {
      binary = true;
      continue;
    }

    if (rawLine.startsWith("--- ")) {
      oldPath = cleanDiffPath(rawLine.slice(4));
      continue;
    }

    if (rawLine.startsWith("+++ ")) {
      newPath = cleanDiffPath(rawLine.slice(4));
      continue;
    }

    if (rawLine.startsWith("@@ ")) {
      const match = rawLine.match(HUNK_HEADER);
      if (!match) {
        continue;
      }

      const [, oldStart, oldCount, newStart, newCount] = match;
      oldLineNumber = Number.parseInt(oldStart ?? "0", 10);
      newLineNumber = Number.parseInt(newStart ?? "0", 10);

      currentHunk = {
        id: hashLine(`${options.filePath}:${rawLine}:${hunks.length}`),
        header: rawLine,
        oldStart: oldLineNumber,
        oldLines: Number.parseInt(oldCount ?? "1", 10),
        newStart: newLineNumber,
        newLines: Number.parseInt(newCount ?? "1", 10),
        lines: []
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (rawLine === "") {
      continue;
    }

    if (rawLine.startsWith("+")) {
      currentHunk.lines.push({
        id: hashLine(`${options.filePath}:${rawLine}:${currentHunk.lines.length}:${newLineNumber}`),
        kind: "add",
        text: rawLine.slice(1),
        oldLineNumber: null,
        newLineNumber,
        lineContentHash: hashLine(rawLine.slice(1)),
        hunkHeader: currentHunk.header
      });
      newLineNumber += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      currentHunk.lines.push({
        id: hashLine(`${options.filePath}:${rawLine}:${currentHunk.lines.length}:${oldLineNumber}`),
        kind: "delete",
        text: rawLine.slice(1),
        oldLineNumber,
        newLineNumber: null,
        lineContentHash: hashLine(rawLine.slice(1)),
        hunkHeader: currentHunk.header
      });
      oldLineNumber += 1;
      continue;
    }

    if (rawLine.startsWith("\\")) {
      currentHunk.lines.push({
        id: hashLine(`${options.filePath}:${rawLine}:${currentHunk.lines.length}`),
        kind: "meta",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: null,
        lineContentHash: hashLine(rawLine),
        hunkHeader: currentHunk.header
      });
      continue;
    }

    currentHunk.lines.push({
      id: hashLine(`${options.filePath}:${rawLine}:${currentHunk.lines.length}:${oldLineNumber}:${newLineNumber}`),
      kind: "context",
      text: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
      oldLineNumber,
      newLineNumber,
      lineContentHash: hashLine(rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine),
      hunkHeader: currentHunk.header
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  }

  return {
    filePath: options.filePath,
    oldPath,
    newPath,
    isBinary: binary || (options.additions === null && options.deletions === null),
    stats: {
      additions: options.additions,
      deletions: options.deletions
    },
    hunks
  };
}

function cleanDiffPath(rawPath: string): string | null {
  if (rawPath === "/dev/null") {
    return null;
  }

  return rawPath.replace(/^[ab]\//, "");
}
