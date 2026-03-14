import { describe, expect, it } from "vitest";
import { filterCommandMenuItems } from "@renderer/command-menu";

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
});
