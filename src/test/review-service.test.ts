import { describe, expect, it, vi } from "vitest";
import { projectsTable, reviewSessionsTable, sessionFilesTable } from "@main/db/schema";
import { ReviewService } from "@main/services/reviews";
import type { GitService } from "@main/services/git";

function createFakeDb() {
  const projects = [
    {
      id: "project_1",
      name: "demo",
      repoPath: "/tmp/demo",
      defaultBaseBranch: "main",
      sortOrder: 1,
      isPinned: false,
      createdAt: 1,
      lastOpenedAt: 1
    }
  ];
  const reviewSessions: Array<{
    id: string;
    projectId: string;
    branchName: string;
    baseBranch: string;
    headSha: string;
    baseSha: string;
    mergeBaseSha: string;
    createdAt: number;
    lastOpenedAt: number;
  }> = [];
  const sessionFiles: Array<{
    id: string;
    sessionId: string;
    filePath: string;
    oldPath: string | null;
    newPath: string | null;
    status: string;
    additions: number | null;
    deletions: number | null;
    isBinary: boolean;
    sortKey: number;
  }> = [];

  return {
    query: {
      projectsTable: {
        findFirst: vi.fn(async () => projects[0] ?? null)
      },
      reviewSessionsTable: {
        findMany: vi.fn(async () => [...reviewSessions].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)),
        findFirst: vi.fn(async ({ where }: { where?: unknown } = {}) => {
          void where;
          return reviewSessions.at(-1) ?? null;
        })
      },
      sessionFilesTable: {
        findMany: vi.fn(async () => [...sessionFiles].sort((left, right) => left.sortKey - right.sortKey)),
        findFirst: vi.fn(async () => sessionFiles[0] ?? null)
      }
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          return {
            run() {
              const nextValues = Array.isArray(values) ? values : [values];
              if (table === reviewSessionsTable) {
                reviewSessions.push(...(nextValues as typeof reviewSessions));
              } else if (table === sessionFilesTable) {
                sessionFiles.push(...(nextValues as typeof sessionFiles));
              }
            }
          };
        }
      };
    },
    update(_table: unknown) {
      return {
        set(_values: Record<string, unknown>) {
          return {
            where(_where: unknown) {
              return {
                run() {
                  return undefined;
                }
              };
            }
          };
        }
      };
    }
  };
}

function createGitMock() {
  let headSha = "head_a";
  const diffText = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1234567..89abcde 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,5 @@",
    " import { app } from 'electron';",
    "+import log from 'electron-log';",
    " const boot = () => {};",
    "-export default boot;",
    "+export default async function bootApp() {}",
    "+bootApp();",
    ""
  ].join("\n");

  const git = {
    getRepoState: vi.fn(async () => ({
      rootPath: "/tmp/demo",
      currentBranch: "feature/demo",
      headSha,
      dirty: false,
      aheadCount: 0
    })),
    safeGetRepoState: vi.fn(async () => ({
      rootPath: "/tmp/demo",
      currentBranch: "feature/demo",
      headSha,
      dirty: false,
      aheadCount: 0
    })),
    getCommitSha: vi.fn(async () => "base_sha"),
    getMergeBase: vi.fn(async () => "merge_sha"),
    getChangedFiles: vi.fn(async (_repoPath: string, _mergeBaseSha: string, _headSha: string, sessionId: string) => [
      {
        id: `${sessionId}:0:src/app.ts`,
        sessionId,
        source: "committed" as const,
        filePath: "src/app.ts",
        oldPath: "src/app.ts",
        newPath: "src/app.ts",
        status: "modified" as const,
        additions: 3,
        deletions: 1,
        isBinary: false
      }
    ]),
    getFileDiff: vi.fn(async () => diffText)
    ,
    getWorkingTreeChangedFiles: vi.fn(async () => []),
    getWorkingTreeFileDiff: vi.fn(async () => "")
  } satisfies Partial<GitService> & {
    getRepoState: GitService["getRepoState"];
    safeGetRepoState: GitService["safeGetRepoState"];
    getCommitSha: GitService["getCommitSha"];
    getMergeBase: GitService["getMergeBase"];
    getChangedFiles: GitService["getChangedFiles"];
    getFileDiff: GitService["getFileDiff"];
    getWorkingTreeChangedFiles: GitService["getWorkingTreeChangedFiles"];
    getWorkingTreeFileDiff: GitService["getWorkingTreeFileDiff"];
  };

  return {
    git: git as unknown as GitService,
    setHeadSha(nextHeadSha: string) {
      headSha = nextHeadSha;
    }
  };
}

describe("ReviewService", () => {
  it("caches file diffs per session and invalidates cache when a new session is created", async () => {
    const db = createFakeDb();
    const { git, setHeadSha } = createGitMock();
    const dispatch = vi.fn();
    const service = new ReviewService(db as never, git, dispatch);

    const openResult = await service.open("project_1");
    const sessionId = openResult.detail.session.id;

    const firstDiff = await service.diff(sessionId, "src/app.ts");
    expect(firstDiff.hunks.length).toBeGreaterThan(0);
    expect(git.getFileDiff).toHaveBeenCalledTimes(1);

    const cachedDiff = await service.diff(sessionId, "src/app.ts");
    expect(cachedDiff).toEqual(firstDiff);
    expect(git.getFileDiff).toHaveBeenCalledTimes(1);

    setHeadSha("head_b");
    const nextSession = await service.open("project_1");
    await service.diff(nextSession.detail.session.id, "src/app.ts");
    expect(git.getFileDiff).toHaveBeenCalledTimes(2);
  });

  it("creates a new session when the base SHA changes even if HEAD stays the same", async () => {
    const db = createFakeDb();
    const { git } = createGitMock();
    const dispatch = vi.fn();
    let baseSha = "base_sha_a";
    let mergeBaseSha = "merge_sha_a";

    vi.mocked(git.getCommitSha).mockImplementation(async () => baseSha);
    vi.mocked(git.getMergeBase).mockImplementation(async () => mergeBaseSha);

    const service = new ReviewService(db as never, git, dispatch);
    const first = await service.open("project_1");

    baseSha = "base_sha_b";
    mergeBaseSha = "merge_sha_b";

    const second = await service.open("project_1");
    expect(second.created).toBe(true);
    expect(second.detail.session.id).not.toBe(first.detail.session.id);
  });

  it("hides committed entries when the same file exists in the working tree", async () => {
    const db = createFakeDb();
    const { git } = createGitMock();
    const dispatch = vi.fn();
    vi.mocked(git.getWorkingTreeChangedFiles).mockResolvedValue([
      {
        id: "working-tree:session_1:src/app.ts",
        sessionId: "session_1",
        source: "working-tree",
        filePath: "src/app.ts",
        oldPath: "src/app.ts",
        newPath: "src/app.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        isBinary: false
      }
    ]);

    const service = new ReviewService(db as never, git, dispatch);
    const openResult = await service.open("project_1");
    const files = await service.files(openResult.detail.session.id);

    expect(files).toHaveLength(1);
    expect(files[0]?.source).toBe("working-tree");
    expect(files[0]?.filePath).toBe("src/app.ts");
  });
});
