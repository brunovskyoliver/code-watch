import { describe, expect, it } from "vitest";
import { scoreFilePathMatch } from "@main/services/file-search";

describe("file-search scoring", () => {
  it("prefers direct file name matches over looser subsequence matches", () => {
    const exact = scoreFilePathMatch("app.ts", "src/app.ts");
    const loose = scoreFilePathMatch("appts", "src/app.ts");

    expect(exact).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(exact!).toBeGreaterThan(loose!);
  });

  it("boosts compact segment matches for path-like queries", () => {
    const focused = scoreFilePathMatch("fil", "src/renderer/file-list.tsx");
    const scattered = scoreFilePathMatch("fil", "src/main/services/file-search.ts");

    expect(focused).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(focused!).toBeGreaterThan(scattered!);
  });

  it("returns null when the query cannot be matched as an ordered subsequence", () => {
    expect(scoreFilePathMatch("zzz", "src/renderer/file-list.tsx")).toBeNull();
  });
});
