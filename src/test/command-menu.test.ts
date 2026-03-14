import { describe, expect, it } from "vitest";
import { createReviewSessionCommandMenuItems, filterCommandMenuItems } from "@renderer/command-menu";

describe("command-menu", () => {
  const items = [
    {
      id: "search-files",
      title: "Search Files",
      subtitle: "Jump to changed files across projects",
      keywords: ["find", "open"]
    },
    {
      id: "add-project",
      title: "Add Repository",
      subtitle: "Add a local Git repository",
      keywords: ["repo", "folder"]
    }
  ] as const;

  it("returns all commands for an empty query", () => {
    expect(filterCommandMenuItems(items, "")).toEqual(items);
  });

  it("matches commands across title, subtitle, and keywords", () => {
    expect(filterCommandMenuItems(items, "repo")).toEqual([items[1]]);
    expect(filterCommandMenuItems(items, "jump changed")).toEqual([items[0]]);
  });

  it("builds session menu items with active-session metadata", () => {
    const sessions = [
      {
        id: "session_live",
        projectId: "project_1",
        branchName: "feature/demo",
        baseBranch: "main",
        headSha: "abcdef123456",
        baseSha: "base_sha",
        mergeBaseSha: "merge_sha",
        createdAt: 1,
        lastOpenedAt: 1
      }
    ] as const;

    expect(createReviewSessionCommandMenuItems(sessions, "session_live")).toEqual([
      {
        id: "review-session:session_live",
        projectId: "project_1",
        sessionId: "session_live",
        title: "feature/demo",
        subtitle: "abcdef1 · base main · current",
        keywords: ["feature/demo", "main", "abcdef123456"],
        active: true
      }
    ]);
  });
});
