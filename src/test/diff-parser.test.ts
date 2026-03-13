import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@main/services/diff-parser";

describe("parseUnifiedDiff", () => {
  it("parses unified diff hunks with stable line numbers", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1234567..89abcde 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,3 +1,4 @@",
        " import { app } from 'electron';",
        "+import log from 'electron-log';",
        " const boot = () => {};",
        "-export default boot;",
        "+export default async function bootApp() {}",
        ""
      ].join("\n"),
      {
        filePath: "src/app.ts",
        oldPath: "src/app.ts",
        newPath: "src/app.ts",
        status: "modified",
        additions: 2,
        deletions: 1
      }
    );

    expect(diff.isBinary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines.map((line) => [line.kind, line.oldLineNumber, line.newLineNumber])).toEqual([
      ["context", 1, 1],
      ["add", null, 2],
      ["context", 2, 3],
      ["delete", 3, null],
      ["add", null, 4]
    ]);
  });

  it("marks binary diffs without inline hunks", () => {
    const diff = parseUnifiedDiff("Binary files a/assets/icon.png and b/assets/icon.png differ\n", {
      filePath: "assets/icon.png",
      oldPath: "assets/icon.png",
      newPath: "assets/icon.png",
      status: "modified",
      additions: null,
      deletions: null
    });

    expect(diff.isBinary).toBe(true);
    expect(diff.hunks).toHaveLength(0);
  });
});
