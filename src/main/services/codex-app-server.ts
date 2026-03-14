import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import log from "electron-log/main";
import type { GitService, WorkingTreeSnapshot } from "@main/services/git";
import { createId } from "@main/services/utils";
import type {
  ChangedFile,
  GitDraftAction,
  GitDraftResult,
  GitRunAction,
  GitRunResult,
  GitWorkflowEvent,
  ReviewSessionDetail
} from "@shared/types";

const CODEX_STARTUP_TIMEOUT_MS = 10_000;
const CODEX_TURN_TIMEOUT_MS = 60_000;
const MAX_DIFF_CHARS = 24_000;
const MAX_DIFF_STAT_CHARS = 4_000;
const MAX_COMMIT_SUBJECTS = 12;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface PendingTurn {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

interface JsonRpcSuccess {
  jsonrpc?: "2.0";
  id: number;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc?: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
  };
}

interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
}

export class CodexAppServerService {
  constructor(
    private readonly git: GitService,
    private readonly dispatchEvent: (channel: string, payload: unknown) => void,
    private readonly codexExecutable = "codex"
  ) {}

  async getStatus(): Promise<{ available: boolean; version: string | null; reason: string | null }> {
    try {
      const version = await this.readVersion();
      return { available: true, version, reason: null };
    } catch (error) {
      return {
        available: false,
        version: null,
        reason: error instanceof Error ? error.message : "Codex CLI is unavailable."
      };
    }
  }

  async draftGitArtifacts(input: {
    repoPath: string;
    session: ReviewSessionDetail;
    files: ChangedFile[];
    action: GitDraftAction;
  }): Promise<GitDraftResult> {
    log.info("[codex] draftGitArtifacts:start", {
      action: input.action,
      sessionId: input.session.session.id,
      repoPath: input.repoPath
    });
    const status = await this.getStatus();
    if (!status.available) {
      throw new Error(
        "Codex CLI was not found on PATH. Install Codex CLI and ensure `codex app-server` works in your terminal."
      );
    }

    const stageablePaths = getStageablePaths(input.files);
    await this.git.stagePaths(input.repoPath, stageablePaths);

    const session = input.session.session;
    const [commitSubjects, diffStat, combinedDiff, workingTree] = await Promise.all([
      this.git.getCommitSubjects(input.repoPath, session.mergeBaseSha, session.headSha),
      this.git.getDiffStat(input.repoPath, session.mergeBaseSha, session.headSha),
      this.git.getCombinedDiff(input.repoPath, session.mergeBaseSha, session.headSha),
      this.git.getWorkingTreeSnapshot(input.repoPath)
    ]);

    const prompt = buildDraftPrompt({
      action: input.action,
      detail: input.session,
      files: input.files,
      commitSubjects,
      diffStat: truncate(diffStat, MAX_DIFF_STAT_CHARS),
      combinedDiff: truncate(combinedDiff, MAX_DIFF_CHARS),
      workingTree: {
        status: truncate(workingTree.status, MAX_DIFF_STAT_CHARS),
        stagedStat: truncate(workingTree.stagedStat, MAX_DIFF_STAT_CHARS),
        unstagedStat: truncate(workingTree.unstagedStat, MAX_DIFF_STAT_CHARS),
        stagedDiff: truncate(workingTree.stagedDiff, MAX_DIFF_CHARS),
        unstagedDiff: truncate(workingTree.unstagedDiff, MAX_DIFF_CHARS)
      }
    });

    const response = await this.runStructuredTurn({
      cwd: input.repoPath,
      prompt
    });

    log.info("[codex] draftGitArtifacts:completed", {
      action: input.action,
      sessionId: input.session.session.id
    });
    return normalizeDraftResult(input.action, response, hasWorkingTreeChanges(workingTree), input.session.dirty);
  }

  async runGitAction(input: {
    repoPath: string;
    session: ReviewSessionDetail;
    files: ChangedFile[];
    action: GitRunAction;
  }): Promise<GitRunResult> {
    const workflowId = createId("git_workflow");
    const stageablePaths = getStageablePaths(input.files);
    await this.git.stagePaths(input.repoPath, stageablePaths);

    if (input.action === "commit") {
      if (stageablePaths.length === 0) {
        throw new Error("No working tree changes are available to commit.");
      }

      try {
        this.emitWorkflow({
          id: workflowId,
          sessionId: input.session.session.id,
          action: input.action,
          stage: "committing",
          title: "Committing changes",
          message: "Codex is drafting a commit message and preparing the commit.",
          prUrl: null
        });

        const draft = await this.draftGitArtifacts({
          repoPath: input.repoPath,
          session: input.session,
          files: input.files,
          action: "commit"
        });
        const commit = draft.commit;
        if (!commit) {
          throw new Error("Codex did not return a commit draft.");
        }

        await this.git.commit(input.repoPath, commit.title, commit.body);
        this.emitWorkflow({
          id: workflowId,
          sessionId: input.session.session.id,
          action: input.action,
          stage: "completed",
          title: "Commit complete",
          message: `Committed changes: ${commit.title}`,
          prUrl: null
        });
        return {
          action: "commit",
          committed: true,
          pushed: false,
          commitTitle: commit.title,
          summary: `Committed changes: ${commit.title}`,
          prUrl: null
        };
      } catch (error) {
        this.emitWorkflow({
          id: workflowId,
          sessionId: input.session.session.id,
          action: input.action,
          stage: "failed",
          title: "Git workflow failed",
          message: error instanceof Error ? error.message : "Git workflow failed.",
          prUrl: null
        });
        throw error;
      }
    }

    try {
      let commitTitle: string | null = null;

      if (stageablePaths.length > 0) {
        this.emitWorkflow({
          id: workflowId,
          sessionId: input.session.session.id,
          action: input.action,
          stage: "committing",
          title: "Committing changes",
          message: "Codex is drafting a commit message and preparing the commit.",
          prUrl: null
        });

        const draft = await this.draftGitArtifacts({
          repoPath: input.repoPath,
          session: input.session,
          files: input.files,
          action: "commit"
        });
        const commit = draft.commit;
        if (!commit) {
          throw new Error("Codex did not return a commit draft.");
        }

        await this.git.commit(input.repoPath, commit.title, commit.body);
        commitTitle = commit.title;
      }

      this.emitWorkflow({
        id: workflowId,
        sessionId: input.session.session.id,
        action: input.action,
        stage: "pushing",
        title: "Pushing branch",
        message: "Pushing the current branch to origin.",
        prUrl: null
      });

      await this.git.pushHead(input.repoPath);

      this.emitWorkflow({
        id: workflowId,
        sessionId: input.session.session.id,
        action: input.action,
        stage: "creating-pr",
        title: "Creating pull request",
        message: "Codex is drafting the PR, then GitHub CLI will create it.",
        prUrl: null
      });

      const liveContext = await this.buildLiveReviewContext(input);
      const draft = await this.draftGitArtifacts({
        repoPath: input.repoPath,
        session: liveContext.session,
        files: liveContext.files,
        action: "pr"
      });
      const pr = draft.pr;
      if (!pr) {
        throw new Error("Codex did not return a PR draft.");
      }

      const prUrl = await this.git.createPullRequest(input.repoPath, pr.title, pr.body);
      this.emitWorkflow({
        id: workflowId,
        sessionId: input.session.session.id,
        action: input.action,
        stage: "completed",
        title: "Pull request created",
        message: pr.title,
        prUrl
      });

      return {
        action: "push",
        committed: commitTitle !== null,
        pushed: true,
        commitTitle,
        summary: "Pushed the branch and created a pull request.",
        prUrl
      };
    } catch (error) {
      this.emitWorkflow({
        id: workflowId,
        sessionId: input.session.session.id,
        action: input.action,
        stage: "failed",
        title: "Git workflow failed",
        message: error instanceof Error ? error.message : "Git workflow failed.",
        prUrl: null
      });
      throw error;
    }
  }

  private async readVersion(): Promise<string> {
    const client = this.spawnClient();
    try {
      log.info("[codex] readVersion:initialize");
      const result = await client.request("initialize", {
        clientInfo: {
          name: "code-watch",
          version: "0.1.0"
        }
      });
      client.notify("initialized");
      const version = extractServerVersion(result);
      await client.close();
      return version;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async runStructuredTurn(input: { cwd: string; prompt: string }): Promise<unknown> {
    const client = this.spawnClient();

    try {
      log.info("[codex] turn:initialize", { cwd: input.cwd, promptLength: input.prompt.length });
      await withTimeout(client.request("initialize", {
        clientInfo: {
          name: "code-watch",
          version: "0.1.0"
        }
      }), CODEX_STARTUP_TIMEOUT_MS, "Timed out while starting Codex app-server.");
      client.notify("initialized");

      log.info("[codex] turn:thread/start");
      const thread = await withTimeout(client.request("thread/start", {}), CODEX_STARTUP_TIMEOUT_MS, "Timed out while creating a Codex thread.");
      const threadId = getNestedString(thread, ["thread", "id"]);
      if (!threadId) {
        throw new Error("Codex app-server did not return a threadId.");
      }

      log.info("[codex] turn:thread/started", { threadId });
      const finalText = await client.runTurn({
        threadId,
        cwd: input.cwd,
        prompt: input.prompt
      });

      log.info("[codex] turn:completed", { threadId, responseLength: finalText.length });
      await client.close();
      return parseJsonDocument(finalText);
    } catch (error) {
      log.error("[codex] turn:failed", error);
      await client.close();
      throw error;
    }
  }

  private spawnClient(): CodexJsonRpcClient {
    return new CodexJsonRpcClient(this.codexExecutable);
  }

  private emitWorkflow(payload: GitWorkflowEvent): void {
    this.dispatchEvent("git.workflowProgress", payload);
  }

  private async buildLiveReviewContext(input: {
    repoPath: string;
    session: ReviewSessionDetail;
  }): Promise<{ session: ReviewSessionDetail; files: ChangedFile[] }> {
    const repoState = await this.git.getRepoState(input.repoPath);
    if (!repoState.currentBranch || !repoState.headSha) {
      throw new Error("The repository is not currently on a local branch.");
    }

    const baseBranch = input.session.session.baseBranch;
    const [baseSha, mergeBaseSha] = await Promise.all([
      this.git.getCommitSha(input.repoPath, baseBranch),
      this.git.getMergeBase(input.repoPath, baseBranch)
    ]);

    const detail: ReviewSessionDetail = {
      session: {
        ...input.session.session,
        branchName: repoState.currentBranch,
        headSha: repoState.headSha,
        baseSha,
        mergeBaseSha
      },
      project: {
        ...input.session.project,
        currentBranch: repoState.currentBranch,
        headSha: repoState.headSha,
        dirty: repoState.dirty
      },
      dirty: repoState.dirty
    };

    const files = await this.git.getChangedFiles(input.repoPath, mergeBaseSha, repoState.headSha, detail.session.id);
    return { session: detail, files };
  }
}

class CodexJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly readline: ReadlineInterface;
  private readonly stderrChunks: string[] = [];
  private readonly completedTurns = new Map<string, string>();
  private readonly completedTurnItems = new Map<string, string>();
  private readonly turnWaiters = new Map<string, PendingTurn>();
  private nextId = 1;
  private closed = false;

  constructor(private readonly executable: string) {
    log.info("[codex] client:spawn", { executable: this.executable });
    this.child = spawn(this.executable, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.readline = createInterface({
      input: this.child.stdout
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string | Buffer) => {
      const value = chunk.toString();
      this.stderrChunks.push(value);
      log.warn("[codex] client:stderr", value.trim());
    });

    this.child.once("error", (error) => {
      log.error("[codex] client:error", error);
      this.rejectAll(new Error(`Failed to start ${this.executable} app-server: ${error.message}`));
    });

    this.child.once("close", (code) => {
      log.info("[codex] client:close", { code });
      this.closed = true;
      if (this.pending.size === 0) {
        return;
      }

      const stderr = this.stderrChunks.join("").trim();
      const reason = stderr ? `${stderr}` : `Exited with code ${code ?? "unknown"}.`;
      this.rejectAll(new Error(`${this.executable} app-server stopped before replying. ${reason}`));
    });

    this.readline.on("line", (line) => {
      this.handleMessage(line);
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;

    log.info("[codex] client:request", { id, method });
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    log.info("[codex] client:notify", { method });
    const payload = {
      jsonrpc: "2.0" as const,
      method,
      params
    };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async runTurn(input: { threadId: string; cwd: string; prompt: string }): Promise<string> {
    log.info("[codex] turn:start", {
      threadId: input.threadId,
      cwd: input.cwd,
      promptLength: input.prompt.length
    });
    const started = await this.request("turn/start", {
      threadId: input.threadId,
      cwd: input.cwd,
      approvalPolicy: "never",
      sandbox: {
        mode: "read-only"
      },
      input: [
        {
          type: "text",
          text: input.prompt
        }
      ]
    });

    const turnId = getNestedString(started, ["turn", "id"]);
    if (!turnId) {
      throw new Error("Codex app-server did not return a turn id.");
    }

    log.info("[codex] turn:started", { threadId: input.threadId, turnId });
    const completed = await withTimeout(
      this.waitForTurnCompletion(turnId),
      CODEX_TURN_TIMEOUT_MS,
      "Timed out waiting for Codex to finish drafting."
    );
    return completed;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.readline.close();
    const closePromise = once(this.child, "close").catch(() => undefined);
    this.child.kill();
    await closePromise;
  }

  private handleMessage(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    log.info("[codex] client:message", trimmed.slice(0, 400));
    const message = JSON.parse(trimmed) as JsonRpcSuccess | JsonRpcFailure | JsonRpcNotification;
    if ("method" in message) {
      this.handleNotification(message);
      return;
    }

    if ("id" in message && "result" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.resolve(message.result);
      return;
    }

    if ("id" in message && "error" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.reject(new Error(message.error.message));
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const [, waiter] of this.turnWaiters) {
      waiter.reject(error);
    }
    this.turnWaiters.clear();
  }

  private waitForTurnCompletion(turnId: string): Promise<string> {
    const completed = this.completedTurns.get(turnId);
    if (completed) {
      return Promise.resolve(completed);
    }

    return new Promise<string>((resolve, reject) => {
      this.turnWaiters.set(turnId, { resolve, reject });
    });
  }

  private handleNotification(message: JsonRpcNotification): void {
    log.info("[codex] client:notification", { method: message.method });
    if (message.method === "item/completed") {
      this.handleCompletedItem(message.params);
      return;
    }

    if (message.method !== "turn/completed") {
      return;
    }

    const turnId = getNestedString(message.params, ["turnId"]) ?? getNestedString(message.params, ["turn", "id"]);
    if (!turnId) {
      return;
    }

    const finalText = extractFinalAgentText(message.params) ?? this.completedTurnItems.get(turnId) ?? null;
    if (!finalText) {
      log.warn("[codex] turn:completed-without-text", { turnId });
      return;
    }

    this.completedTurns.set(turnId, finalText);
    this.completedTurnItems.delete(turnId);
    const waiter = this.turnWaiters.get(turnId);
    if (!waiter) {
      return;
    }

    this.turnWaiters.delete(turnId);
    waiter.resolve(finalText);
  }

  private handleCompletedItem(params: unknown): void {
    const turnId = getNestedString(params, ["turnId"]) ?? getNestedString(params, ["item", "turnId"]);
    if (!turnId) {
      return;
    }

    const text = getNestedString(params, ["item", "text"]);
    if (!text) {
      return;
    }

    this.completedTurnItems.set(turnId, text);
  }
}

function buildDraftPrompt(input: {
  action: GitDraftAction;
  detail: ReviewSessionDetail;
  files: ChangedFile[];
  commitSubjects: string[];
  diffStat: string;
  combinedDiff: string;
  workingTree: WorkingTreeSnapshot;
}): string {
  const changedFiles = input.files
    .map((file) => {
      const stats = file.isBinary ? "binary" : `+${file.additions ?? 0}/-${file.deletions ?? 0}`;
      return `- ${file.filePath} (${file.status}, ${stats})`;
    })
    .join("\n");

  const commitSubjects = input.commitSubjects.length > 0
    ? input.commitSubjects.slice(0, MAX_COMMIT_SUBJECTS).map((subject) => `- ${subject}`).join("\n")
    : "- No commits found in the branch range.";

  const hasLiveWorkingTree = hasWorkingTreeChanges(input.workingTree);

  return [
    "You are drafting git metadata for a local desktop review app.",
    "Use only the supplied context. Do not run tools or commands. Do not mention that you are an AI.",
    "Return a single JSON object and nothing else.",
    "",
    "JSON shape:",
    "{",
    '  "commit": { "title": string, "body": string } | null,',
    '  "pr": { "title": string, "body": string } | null',
    "}",
    "",
    "Formatting rules:",
    "- Commit titles must be imperative and at most 72 characters.",
    "- Commit bodies should be concise and can be empty strings if unnecessary.",
    "- PR bodies should use these markdown sections when present: Summary, Testing, Risks.",
    "- If an action is not requested, return null for that field.",
    "- For commit drafting, prefer the live working tree context when it has changes. Use the committed review context only as fallback.",
    "- For PR drafting, use the committed review context, not the live working tree.",
    "",
    `Requested action: ${input.action}`,
    `Project: ${input.detail.project.name}`,
    `Branch: ${input.detail.session.branchName}`,
    `Base branch: ${input.detail.session.baseBranch}`,
    `Head SHA: ${input.detail.session.headSha}`,
    `Merge base SHA: ${input.detail.session.mergeBaseSha}`,
    `Dirty working tree present: ${input.detail.dirty ? "yes" : "no"}`,
    `Live working tree changes available for commit drafting: ${hasLiveWorkingTree ? "yes" : "no"}`,
    "",
    "Commit draft context: current working tree",
    "Working tree status:",
    input.workingTree.status || "(clean)",
    "",
    "Staged diff stat:",
    input.workingTree.stagedStat || "(empty)",
    "",
    "Staged diff excerpt:",
    input.workingTree.stagedDiff || "(empty)",
    "",
    "Unstaged diff stat:",
    input.workingTree.unstagedStat || "(empty)",
    "",
    "Unstaged diff excerpt:",
    input.workingTree.unstagedDiff || "(empty)",
    "",
    "PR draft context: committed review session",
    "Changed files:",
    changedFiles || "- No changed files.",
    "",
    "Existing commit subjects in this branch range:",
    commitSubjects,
    "",
    "Diff stat:",
    input.diffStat || "(empty)",
    "",
    "Unified diff excerpt:",
    input.combinedDiff || "(empty)"
  ].join("\n");
}

function normalizeDraftResult(action: GitDraftAction, raw: unknown, hasWorkingTree: boolean, dirty: boolean): GitDraftResult {
  const commit = getDocument(raw, "commit");
  const pr = getDocument(raw, "pr");

  return {
    action,
    commit: action === "pr" ? null : commit,
    pr: action === "commit" ? null : pr,
    warning: getDraftWarning(action, hasWorkingTree, dirty)
  };
}

function extractFinalAgentText(result: unknown): string | null {
  const items = getObjectArray(result, "items");
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || typeof item !== "object") {
      continue;
    }

    if (getNestedString(item, ["item", "type"]) !== "agentMessage") {
      continue;
    }

    const text = getNestedString(item, ["item", "text"]);
    if (text) {
      return text;
    }
  }

  return null;
}

function extractServerVersion(result: unknown): string {
  const version = getNestedString(result, ["serverInfo", "version"]);
  return version ?? "unknown";
}

function getDocument(value: unknown, key: "commit" | "pr"): { title: string; body: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const document = record[key];
  if (!document || typeof document !== "object") {
    return null;
  }

  const title = getObjectString(document, "title");
  const body = getObjectString(document, "body");
  if (!title && !body) {
    return null;
  }

  return {
    title: title ?? "",
    body: body ?? ""
  };
}

function getObjectString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidate = record[key];
  return typeof candidate === "string" ? candidate : null;
}

function getObjectArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidate = record[key];
  return Array.isArray(candidate) ? candidate : [];
}

function getNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

function parseJsonDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Codex returned invalid JSON: ${message}`);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function hasWorkingTreeChanges(snapshot: WorkingTreeSnapshot): boolean {
  return [
    snapshot.status,
    snapshot.stagedStat,
    snapshot.unstagedStat,
    snapshot.stagedDiff,
    snapshot.unstagedDiff
  ].some((value) => value.trim().length > 0);
}

function getStageablePaths(files: ChangedFile[]): string[] {
  return [...new Set(files.filter((file) => file.source === "working-tree").map((file) => file.filePath))];
}

function getDraftWarning(action: GitDraftAction, hasWorkingTree: boolean, dirty: boolean): string | null {
  if (action === "pr" && dirty) {
    return "PR drafts reflect committed branch changes only. Uncommitted work is not included.";
  }

  if (action === "commit-and-pr" && hasWorkingTree) {
    return "Commit drafts include current staged and unstaged changes. PR drafts reflect committed branch changes only.";
  }

  if (action === "commit" && hasWorkingTree) {
    return "Commit drafts include current staged and unstaged changes on the branch.";
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
