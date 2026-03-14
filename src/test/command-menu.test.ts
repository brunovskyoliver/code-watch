import { describe, expect, it } from "vitest";
import { createBranchCommandMenuItems, filterCommandMenuItems } from "@renderer/command-menu";

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

  it("builds branch menu items with active-branch metadata", () => {
    expect(createBranchCommandMenuItems("project_1", ["main", "feature/demo"], "feature/demo")).toEqual([
      {
        id: "branch:project_1:main",
        projectId: "project_1",
        branch: "main",
        title: "main",
        subtitle: "Switch review to this base branch",
        keywords: ["main"],
        active: false
      },
      {
        id: "branch:project_1:feature/demo",
        projectId: "project_1",
        branch: "feature/demo",
        title: "feature/demo",
        subtitle: "Current base branch",
        keywords: ["feature", "demo"],
        active: true
      }
    ]);
  });
});
