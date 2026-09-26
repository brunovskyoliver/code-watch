import { describe, expect, it } from "vitest";
import { canPushCurrentBranch } from "@renderer/git-actions";
import type { ChangedFile, ProjectSummary, ReviewSessionDetail } from "@shared/types";

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "project_1",
    name: "demo",
    repoPath: "/tmp/demo",
    defaultBaseBranch: "main",
    sortOrder: 1,
    isPinned: false,
    createdAt: 1,
    lastOpenedAt: 1,
    currentBranch: "feature/demo",
    headSha: "head_sha",
    dirty: false,
    aheadCount: 0,
    ...overrides
  };
}

function makeSession(overrides: Partial<ReviewSessionDetail> = {}): ReviewSessionDetail {
  return {
    session: {
      id: "session_1",
      projectId: "project_1",
      branchName: "feature/demo",
      baseBranch: "main",
      headSha: "head_sha",
      baseSha: "base_sha",
      mergeBaseSha: "merge_base_sha",
      createdAt: 1,
      lastOpenedAt: 1
    },
    project: makeProject(),
    dirty: false,
    ...overrides
  };
}

const committedFile: ChangedFile = {
  id: "file_1",
  sessionId: "session_1",
  source: "committed",
  filePath: "src/app.ts",
  oldPath: "src/app.ts",
  newPath: "src/app.ts",
  status: "modified",
  additions: 3,
  deletions: 1,
  isBinary: false
};

describe("canPushCurrentBranch", () => {
  it("allows push when the branch is ahead of its upstream", () => {
    expect(canPushCurrentBranch({
      project: makeProject({ aheadCount: 2 }),
      session: makeSession(),
      files: []
    })).toBe(true);
  });

  it("allows push for committed review changes on the current branch without an upstream ahead count", () => {
    expect(canPushCurrentBranch({
      project: makeProject({ aheadCount: 0 }),
      session: makeSession(),
      files: [committedFile]
    })).toBe(true);
  });

  it("does not allow push for working tree changes alone", () => {
    expect(canPushCurrentBranch({
      project: makeProject({ aheadCount: 0 }),
      session: makeSession(),
      files: [{ ...committedFile, source: "working-tree" }]
    })).toBe(false);
  });

  it("does not allow push from a stale session that is not the current branch", () => {
    expect(canPushCurrentBranch({
      project: makeProject({ currentBranch: "feature/live", aheadCount: 0 }),
      session: makeSession(),
      files: [committedFile]
    })).toBe(false);
  });
});
