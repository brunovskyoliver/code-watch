import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppStore, useAppStore } from "@renderer/store/app-store";
import type {
  ChangedFile,
  CodeWatchApi,
  PaginatedComments,
  PaginatedFileDiff,
  ProjectSummary,
  ReviewOpenResult,
  ReviewSessionDetail,
  ReviewSessionSummary,
  ThreadPreview
} from "@shared/types";

function makeProject(headSha: string): ProjectSummary {
  return {
    id: "project_1",
    name: "demo",
    repoPath: "/tmp/demo",
    defaultBaseBranch: "main",
    createdAt: 1,
    lastOpenedAt: 1,
    currentBranch: "feature/demo",
    headSha,
    dirty: false
  };
}

function makeSessionSummary(id: string, headSha: string): ReviewSessionSummary {
  return {
    id,
    projectId: "project_1",
    branchName: "feature/demo",
    baseBranch: "main",
    headSha,
    baseSha: "base_sha",
    mergeBaseSha: "merge_sha",
    createdAt: 1,
    lastOpenedAt: 1
  };
}

function makeDetail(id: string, headSha: string): ReviewSessionDetail {
  return {
    session: makeSessionSummary(id, headSha),
    project: makeProject(headSha),
    dirty: false
  };
}

const files: ChangedFile[] = [
  {
    id: "file_1",
    sessionId: "session_live",
    filePath: "src/app.ts",
    oldPath: "src/app.ts",
    newPath: "src/app.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    isBinary: false
  }
];

const emptyDiff: PaginatedFileDiff = {
  filePath: "src/app.ts",
  oldPath: "src/app.ts",
  newPath: "src/app.ts",
  isBinary: false,
  stats: {
    additions: 3,
    deletions: 1
  },
  rows: [],
  nextCursor: null,
  hasMore: false,
  totalRowCount: 0
};

const emptyThreadPage: PaginatedComments = {
  threadId: "thread_1",
  comments: [],
  nextCursor: null,
  hasMore: false
};

describe("app-store", () => {
  let currentProject = makeProject("head_live");
  let liveResult: ReviewOpenResult = {
    created: false,
    detail: makeDetail("session_live", "head_live")
  };
  let sessions: ReviewSessionSummary[] = [
    makeSessionSummary("session_live", "head_live"),
    makeSessionSummary("session_pinned", "head_old")
  ];

  beforeEach(() => {
    currentProject = makeProject("head_live");
    liveResult = {
      created: false,
      detail: makeDetail("session_live", "head_live")
    };
    sessions = [makeSessionSummary("session_live", "head_live"), makeSessionSummary("session_pinned", "head_old")];

    const api: CodeWatchApi = {
      projects: {
        pickDirectory: vi.fn(async () => null),
        add: vi.fn(),
        list: vi.fn(async () => [currentProject]),
        remove: vi.fn(async () => undefined),
        updateBaseBranch: vi.fn(async () => currentProject)
      },
      reviews: {
        open: vi.fn(async () => liveResult),
        list: vi.fn(async () => sessions),
        load: vi.fn(async (sessionId: string) => makeDetail(sessionId, sessionId === "session_live" ? "head_live" : "head_old")),
        files: vi.fn(async () => files),
        diff: vi.fn(async () => emptyDiff)
      },
      threads: {
        listForFile: vi.fn(async () => [] as ThreadPreview[]),
        get: vi.fn(async () => emptyThreadPage),
        create: vi.fn(),
        addComment: vi.fn(),
        resolve: vi.fn(),
        reopen: vi.fn()
      },
      events: {
        onRepoChanged: vi.fn(() => () => undefined),
        onBranchChanged: vi.fn(() => () => undefined),
        onDirtyStateChanged: vi.fn(() => () => undefined),
        onReviewSessionCreated: vi.fn(() => () => undefined)
      }
    };

    Object.defineProperty(globalThis, "window", {
      value: { codeWatch: api },
      configurable: true,
      writable: true
    });

    resetAppStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a pinned session selected while refreshing the live session in the background", async () => {
    await useAppStore.getState().selectProject("project_1");
    await useAppStore.getState().selectSession("project_1", "session_pinned");

    currentProject = makeProject("head_new");
    liveResult = {
      created: true,
      detail: makeDetail("session_live_new", "head_new")
    };
    sessions = [makeSessionSummary("session_live_new", "head_new"), makeSessionSummary("session_pinned", "head_old")];

    await useAppStore.getState().refreshProject("project_1");

    const state = useAppStore.getState();
    expect(state.reviewMode).toBe("pinned");
    expect(state.activeSession?.session.id).toBe("session_pinned");
    expect(state.liveSessionId).toBe("session_live_new");
    expect(state.projects[0]?.headSha).toBe("head_new");
  });
});
