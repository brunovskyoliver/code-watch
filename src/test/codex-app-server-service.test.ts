import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn()
}));

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { CodexAppServerService } from "@main/services/codex-app-server";
import { OpenCodeAppServerService } from "@main/services/opencode-app-server";
import type { GitService } from "@main/services/git";
import type { ChangedFile, ReviewSessionDetail } from "@shared/types";

function createMockChild() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kill = vi.fn(() => {
    process.emit("close", 0);
  });
  return process;
}

const detail: ReviewSessionDetail = {
  session: {
    id: "session_1",
    projectId: "project_1",
    branchName: "feature/drafts",
    baseBranch: "main",
    headSha: "head_sha",
    baseSha: "base_sha",
    mergeBaseSha: "merge_base_sha",
    createdAt: 1,
    lastOpenedAt: 1
  },
  project: {
    id: "project_1",
    name: "Code Watch",
    repoPath: "/tmp/code-watch",
    defaultBaseBranch: "main",
    sortOrder: 1,
    isPinned: false,
    createdAt: 1,
    lastOpenedAt: 1,
    currentBranch: "feature/drafts",
    headSha: "head_sha",
    dirty: true
  },
  dirty: true
};

const files: ChangedFile[] = [
  {
    id: "file_1",
    sessionId: "session_1",
    source: "working-tree",
    filePath: "src/renderer/App.tsx",
    oldPath: "src/renderer/App.tsx",
    newPath: "src/renderer/App.tsx",
    status: "modified",
    additions: 12,
    deletions: 4,
    isBinary: false
  }
];

describe("CodexAppServerService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drafts commit and PR text through codex app-server", async () => {
    const spawnMock = vi.mocked(spawn);
    const seenPrompts: string[] = [];

    spawnMock.mockImplementation(() => {
      const child = createMockChild();
      let lineBuffer = "";
      let turnCounter = 0;

      child.stdin.on("data", (chunk: Buffer | string) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const message = JSON.parse(line) as { id?: number; method?: string; params?: { input?: Array<{ text?: string }> } };
          if (message.method === "initialize" && message.id) {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { serverInfo: { version: "1.2.3" } }
            })}\n`);
            continue;
          }

          if (message.method === "thread/start" && message.id) {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { thread: { id: "thread_1" } }
            })}\n`);
            continue;
          }

          if (message.method === "turn/start" && message.id) {
            turnCounter += 1;
            seenPrompts.push(message.params?.input?.[0]?.text ?? "");
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { turn: { id: `turn_${turnCounter}` } }
            })}\n`);
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              method: "item/completed",
              params: {
                item: {
                  turnId: `turn_${turnCounter}`,
                  text: JSON.stringify({
                    commit: {
                      title: "Add Codex draft generation",
                      body: "Wire the topbar actions to the Codex app-server."
                    },
                    pr: {
                      title: "Add Codex git draft generation",
                      body: "## Summary\n- wire commit and PR drafting\n\n## Testing\n- bun run test"
                    }
                  })
                }
              }
            })}\n`);
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              method: "turn/completed",
              params: {
                threadId: "thread_1",
                turn: {
                  id: `turn_${turnCounter}`,
                  items: [],
                  status: "completed",
                  error: null
                }
              }
            })}\n`);
          }
        }
      });

      return child as never;
    });

    const git = {
      stagePaths: vi.fn(async () => undefined),
      getCommitSubjects: vi.fn(async () => ["Add draft shell"]),
      getDiffStat: vi.fn(async () => " App.tsx | 16 ++++++++++++----"),
      getCombinedDiff: vi.fn(async () => "diff --git a/App.tsx b/App.tsx\n+draft"),
      getWorkingTreeSnapshot: vi.fn(async () => ({
        status: " M src/renderer/App.tsx",
        stagedStat: "",
        unstagedStat: " App.tsx | 3 ++-",
        stagedDiff: "",
        unstagedDiff: "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+draft"
      }))
    } as unknown as GitService;

    const service = new CodexAppServerService(git, vi.fn());
    const result = await service.draftGitArtifacts({
      repoPath: detail.project.repoPath,
      session: detail,
      files,
      action: "commit-and-pr"
    });

    expect(result.commit?.title).toBe("Add Codex draft generation");
    expect(result.pr?.title).toBe("Add Codex git draft generation");
    expect(result.warning).toContain("Commit drafts include current staged and unstaged changes");
    expect(seenPrompts).toHaveLength(1);
    expect(seenPrompts[0]).toContain("Requested action: commit-and-pr");
    expect(seenPrompts[0]).toContain("src/renderer/App.tsx");
    expect(seenPrompts[0]).toContain("Commit draft context: current working tree");
    expect(git.stagePaths).toHaveBeenCalledWith(detail.project.repoPath, ["src/renderer/App.tsx"]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("stages, commits, and pushes when requested", async () => {
    const spawnMock = vi.mocked(spawn);

    spawnMock.mockImplementation(() => {
      const child = createMockChild();
      let lineBuffer = "";
      let turnCounter = 0;

      child.stdin.on("data", (chunk: Buffer | string) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const message = JSON.parse(line) as { id?: number; method?: string; params?: { input?: Array<{ text?: string }> } };
          if (message.method === "initialize" && message.id) {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { serverInfo: { version: "1.2.3" } }
            })}\n`);
            continue;
          }

          if (message.method === "thread/start" && message.id) {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { thread: { id: "thread_1" } }
            })}\n`);
            continue;
          }

          if (message.method === "turn/start" && message.id) {
            turnCounter += 1;
            const prompt = message.params?.input?.[0]?.text ?? "";
            const responseBody = prompt.includes("Requested action: pr")
              ? {
                commit: null,
                pr: {
                  title: "Ship git automation",
                  body: "## Summary\n- create the PR after pushing\n\n## Testing\n- bun run test"
                }
              }
              : {
                commit: {
                  title: "Ship git automation",
                  body: "Stage reviewed files and push the branch."
                },
                pr: null
              };
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { turn: { id: `turn_${turnCounter}` } }
            })}\n`);
            child.stdout.write(`${JSON.stringify({
              jsonrpc: "2.0",
              method: "turn/completed",
              params: {
                turnId: `turn_${turnCounter}`,
                items: [
                  {
                    item: {
                      type: "agentMessage",
                      text: JSON.stringify(responseBody)
                    }
                  }
                ]
              }
            })}\n`);
          }
        }
      });

      return child as never;
    });

    const git = {
      stagePaths: vi.fn(async () => undefined),
      getRepoState: vi.fn(async () => ({
        rootPath: detail.project.repoPath,
        currentBranch: detail.session.branchName,
        headSha: "head_after_push",
        dirty: false
      })),
      getCommitSha: vi.fn(async () => detail.session.baseSha),
      getMergeBase: vi.fn(async () => detail.session.mergeBaseSha),
      getChangedFiles: vi.fn(async () => [
        {
          ...files[0]!,
          id: "committed_file_1",
          source: "committed" as const
        }
      ]),
      getCommitSubjects: vi.fn(async () => ["Ship git automation"]),
      getDiffStat: vi.fn(async () => " App.tsx | 10 +++++-----"),
      getCombinedDiff: vi.fn(async () => "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+push"),
      getWorkingTreeSnapshot: vi.fn(async () => ({
        status: " M src/renderer/App.tsx",
        stagedStat: "",
        unstagedStat: " App.tsx | 10 +++++-----",
        stagedDiff: "",
        unstagedDiff: "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+push"
      })),
      commit: vi.fn(async () => undefined),
      pushHead: vi.fn(async () => undefined),
      createPullRequest: vi.fn(async () => "https://github.com/openai/code-watch/pull/12")
    } as unknown as GitService;

    const service = new CodexAppServerService(git, vi.fn());
    const result = await service.runGitAction({
      repoPath: detail.project.repoPath,
      session: detail,
      files,
      action: "push"
    });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.prUrl).toBe("https://github.com/openai/code-watch/pull/12");
    expect(result.commitTitle).toBe("Ship git automation");
    expect(git.stagePaths).toHaveBeenCalledWith(detail.project.repoPath, ["src/renderer/App.tsx"]);
    expect(git.commit).toHaveBeenCalledWith(
      detail.project.repoPath,
      "Ship git automation",
      "Stage reviewed files and push the branch."
    );
    expect(git.pushHead).toHaveBeenCalledWith(detail.project.repoPath);
    expect(git.createPullRequest).toHaveBeenCalledWith(
      detail.project.repoPath,
      expect.any(String),
      expect.any(String)
    );
  });

  it("pushes without creating a PR when the current branch matches the base branch", async () => {
    const git = {
      stagePaths: vi.fn(async () => undefined),
      getCommitSubjects: vi.fn(async () => ["Ship git automation"]),
      getDiffStat: vi.fn(async () => " App.tsx | 10 +++++-----"),
      getCombinedDiff: vi.fn(async () => "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+push"),
      getWorkingTreeSnapshot: vi.fn(async () => ({
        status: "",
        stagedStat: "",
        unstagedStat: "",
        stagedDiff: "",
        unstagedDiff: ""
      })),
      commit: vi.fn(async () => undefined),
      pushHead: vi.fn(async () => undefined),
      getRepoState: vi.fn(async () => ({
        rootPath: detail.project.repoPath,
        currentBranch: "main",
        headSha: "head_after_push",
        dirty: false
      })),
      getCommitSha: vi.fn(async () => detail.session.baseSha),
      getMergeBase: vi.fn(async () => "head_after_push"),
      getChangedFiles: vi.fn(async () => []),
      createPullRequest: vi.fn(async () => "https://github.com/openai/code-watch/pull/12")
    } as unknown as GitService;

    const service = new CodexAppServerService(git, vi.fn());
    const result = await service.runGitAction({
      repoPath: detail.project.repoPath,
      session: {
        ...detail,
        session: {
          ...detail.session,
          branchName: "main",
          baseBranch: "main"
        }
      },
      files: [],
      action: "push"
    });

    expect(result.pushed).toBe(true);
    expect(result.prUrl).toBeNull();
    expect(result.summary).toContain("PR skipped because the current branch matches the base branch");
    expect(git.pushHead).toHaveBeenCalledWith(detail.project.repoPath);
    expect(git.createPullRequest).not.toHaveBeenCalled();
  });

  it("pushes without creating a PR when there are no committed changes relative to the base branch", async () => {
    const git = {
      stagePaths: vi.fn(async () => undefined),
      getCommitSubjects: vi.fn(async () => ["Ship git automation"]),
      getDiffStat: vi.fn(async () => " App.tsx | 10 +++++-----"),
      getCombinedDiff: vi.fn(async () => "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+push"),
      getWorkingTreeSnapshot: vi.fn(async () => ({
        status: "",
        stagedStat: "",
        unstagedStat: "",
        stagedDiff: "",
        unstagedDiff: ""
      })),
      commit: vi.fn(async () => undefined),
      pushHead: vi.fn(async () => undefined),
      getRepoState: vi.fn(async () => ({
        rootPath: detail.project.repoPath,
        currentBranch: "feature/codex",
        headSha: "same_sha",
        dirty: false
      })),
      getCommitSha: vi.fn(async () => detail.session.baseSha),
      getMergeBase: vi.fn(async () => "same_sha"),
      getChangedFiles: vi.fn(async () => []),
      createPullRequest: vi.fn(async () => "https://github.com/openai/code-watch/pull/12")
    } as unknown as GitService;

    const service = new CodexAppServerService(git, vi.fn());
    const result = await service.runGitAction({
      repoPath: detail.project.repoPath,
      session: {
        ...detail,
        session: {
          ...detail.session,
          branchName: "feature/codex",
          baseBranch: "main"
        }
      },
      files: [],
      action: "push"
    });

    expect(result.pushed).toBe(true);
    expect(result.prUrl).toBeNull();
    expect(result.summary).toContain("PR skipped because there are no committed changes relative to main");
    expect(git.pushHead).toHaveBeenCalledWith(detail.project.repoPath);
    expect(git.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("OpenCodeAppServerService", () => {
  const defaultOpenCodeModel = "github-copilot/gemini-3-flash-preview";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports OpenCode CLI status from --version", async () => {
    vi.mocked(execFile).mockImplementation((...args) => {
      const argsList = args[1] as string[];
      const callback = typeof args[2] === "function" ? args[2] : args[3];
      if (typeof callback === "function") {
        if (argsList[0] === "models") {
          callback(null, `Models cache refreshed\n${defaultOpenCodeModel}\n`, "");
        } else {
          callback(null, "1.2.20\n", "");
        }
      }
      return {} as never;
    });

    const git = {} as unknown as GitService;
    const service = new OpenCodeAppServerService(git, vi.fn());
    const status = await service.getStatus();
    expect(status.available || status.available === false).toBe(true);
    if (status.available) {
      expect(status.version).toBeTruthy();
    } else {
      expect(status.reason).toBeTruthy();
    }
  });

  it("drafts using opencode run JSON events", async () => {
    const git = {
      stagePaths: vi.fn(async () => undefined),
      getCommitSubjects: vi.fn(async () => ["Use OpenCode for git drafting"]),
      getDiffStat: vi.fn(async () => " App.tsx | 4 ++--"),
      getCombinedDiff: vi.fn(async () => "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+opencode"),
      getWorkingTreeSnapshot: vi.fn(async () => ({
        status: " M src/renderer/App.tsx",
        stagedStat: "",
        unstagedStat: " App.tsx | 4 ++--",
        stagedDiff: "",
        unstagedDiff: "diff --git a/src/renderer/App.tsx b/src/renderer/App.tsx\n+opencode"
      }))
    } as unknown as GitService;

    const service = new OpenCodeAppServerService(git, vi.fn());
    vi.spyOn(service, "getStatus").mockResolvedValue({ available: true, version: "1.2.20", reason: null });
    vi.spyOn(service as unknown as { runStructuredTurn: (input: { cwd: string; prompt: string }) => Promise<unknown> }, "runStructuredTurn")
      .mockResolvedValue({
        commit: {
          title: "Use OpenCode for git drafting",
          body: "Mirror codex app-server behavior with OpenCode run mode."
        },
        pr: null
      });

    const result = await service.draftGitArtifacts({
      repoPath: detail.project.repoPath,
      session: detail,
      files,
      action: "commit"
    });

    expect(result.commit?.title).toBe("Use OpenCode for git drafting");
    expect(result.pr).toBeNull();
  });

  it("builds tool-restricted inline config for OpenCode run", async () => {
    vi.mocked(execFile).mockImplementation((...args) => {
      const callback = typeof args[2] === "function" ? args[2] : args[3];
      if (typeof callback === "function") {
        callback(null, "1.2.20\n", "");
      }
      return {} as never;
    });

    const git = {} as unknown as GitService;
    const service = new OpenCodeAppServerService(git, vi.fn());

    await service.getStatus();

    const statusCall = vi.mocked(execFile).mock.calls[0];
    const options = statusCall?.[2];
    expect(options).toMatchObject({ timeout: 8000 });

    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation((...args) => {
      const argsList = args[1] as string[];
      if (argsList[0] === "--version") {
        const callback = typeof args[2] === "function" ? args[2] : args[3];
        if (typeof callback === "function") {
          callback(null, "1.2.20\n", "");
        }
        return {} as never;
      }
      if (argsList[0] === "models") {
        const callback = typeof args[2] === "function" ? args[2] : args[3];
        if (typeof callback === "function") {
          callback(null, `Models cache refreshed\n${defaultOpenCodeModel}\n`, "");
        }
        return {} as never;
      }

      const optionsArg = typeof args[2] === "object" ? args[2] : undefined;
      expect(optionsArg).toBeDefined();
      const env = (optionsArg as { env?: Record<string, string> }).env;
      expect(env?.OPENCODE_CONFIG_CONTENT).toBeTruthy();
      const parsed = JSON.parse(env!.OPENCODE_CONFIG_CONTENT!);
      expect(parsed.share).toBe("disabled");
      expect(parsed.tools).toMatchObject({
        bash: false,
        read: false,
        edit: false,
        write: false,
        grep: false,
        glob: false
      });
      expect(argsList).toContain(defaultOpenCodeModel);

      const callback = args[3];
      if (typeof callback === "function") {
        callback(null, `${JSON.stringify({
          type: "text",
          part: { type: "text", text: JSON.stringify({ commit: { title: "x", body: "y" }, pr: null }) }
        })}\n`, "");
      }
      return {} as never;
    });

    await service.getStatus();

    const runTurn = (service as unknown as { runStructuredTurn: (input: { cwd: string; prompt: string }) => Promise<unknown> }).runStructuredTurn.bind(service);
    await expect(runTurn({ cwd: "/tmp/code-watch", prompt: "hello" })).rejects.toThrow();
  });
});
