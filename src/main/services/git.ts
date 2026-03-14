import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, FileStatus } from "@shared/types";

const execFileAsync = promisify(execFile);

export interface RepoState {
  rootPath: string;
  currentBranch: string | null;
  headSha: string | null;
  dirty: boolean;
  aheadCount: number;
}

export interface WorkingTreeSnapshot {
  status: string;
  stagedStat: string;
  unstagedStat: string;
  stagedDiff: string;
  unstagedDiff: string;
}

interface ParsedStatusLine {
  status: FileStatus;
  filePath: string;
  oldPath: string | null;
  newPath: string | null;
}

interface ParsedNumstatLine {
  filePath: string;
  additions: number | null;
  deletions: number | null;
}

export class GitService {
  async resolveRepoRoot(repoPath: string): Promise<string> {
    const root = await this.runGit(repoPath, ["rev-parse", "--show-toplevel"]);
    return path.normalize(root.trim());
  }

  async assertGitRepo(repoPath: string): Promise<string> {
    const root = await this.resolveRepoRoot(repoPath);
    const inside = await this.runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.trim() !== "true") {
      throw new Error(`${repoPath} is not a Git working tree.`);
    }
    return root;
  }

  async detectBaseBranch(repoPath: string): Promise<string> {
    const root = await this.assertGitRepo(repoPath);

    try {
      const remoteHead = await this.runGit(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
      const branch = remoteHead.trim().split("/").pop();
      if (branch) {
        return branch;
      }
    } catch {
      // Fall through to local defaults.
    }

    for (const candidate of ["main", "master"]) {
      if (await this.hasRef(root, candidate)) {
        return candidate;
      }
    }

    throw new Error("Unable to detect a default base branch. Set one manually after adding the project.");
  }

  async getRepoState(repoPath: string): Promise<RepoState> {
    const rootPath = await this.assertGitRepo(repoPath);
    const [currentBranch, headSha, dirty, aheadCount] = await Promise.all([
      this.runGit(rootPath, ["branch", "--show-current"]).then((value) => value.trim() || null),
      this.runGit(rootPath, ["rev-parse", "HEAD"]).then((value) => value.trim()).catch(() => null),
      this.runGit(rootPath, ["status", "--porcelain=v1"]).then((value) => value.trim().length > 0),
      this.getAheadCount(rootPath)
    ]);

    return { rootPath, currentBranch, headSha, dirty, aheadCount };
  }

  async safeGetRepoState(repoPath: string): Promise<RepoState | null> {
    try {
      return await this.getRepoState(repoPath);
    } catch {
      return null;
    }
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const rootPath = await this.assertGitRepo(repoPath);
    const output = await this.runGit(rootPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);

    return [...new Set(output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.endsWith("/HEAD")))]
      .sort((a, b) => a.localeCompare(b));
  }

  async getCommitSha(repoPath: string, ref: string): Promise<string> {
    return (await this.runGit(repoPath, ["rev-parse", ref])).trim();
  }

  async getMergeBase(repoPath: string, baseBranch: string): Promise<string> {
    return (await this.runGit(repoPath, ["merge-base", "HEAD", baseBranch])).trim();
  }

  async getChangedFiles(repoPath: string, mergeBaseSha: string, headSha: string, sessionId: string): Promise<ChangedFile[]> {
    const [statusOutput, numstatOutput] = await Promise.all([
      this.runGit(repoPath, ["diff", "--name-status", "--find-renames", mergeBaseSha, headSha]),
      this.runGit(repoPath, ["diff", "--numstat", "--find-renames", mergeBaseSha, headSha])
    ]);

    const statusLines = statusOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => this.parseStatusLine(line));

    const numstatMap = new Map<string, ParsedNumstatLine>();
    for (const line of numstatOutput.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
      const parsed = this.parseNumstatLine(line);
      numstatMap.set(parsed.filePath, parsed);
    }

    return statusLines.map((line, index) => {
      const stats = numstatMap.get(line.filePath) ?? { additions: 0, deletions: 0 };

      return {
        id: `${sessionId}:${index}:${line.filePath}`,
        sessionId,
        source: "committed",
        filePath: line.filePath,
        oldPath: line.oldPath,
        newPath: line.newPath,
        status: line.status,
        additions: stats.additions ?? null,
        deletions: stats.deletions ?? null,
        isBinary: stats.additions === null && stats.deletions === null
      };
    });
  }

  async getFileDiff(repoPath: string, mergeBaseSha: string, headSha: string, filePath: string): Promise<string> {
    return this.runGit(repoPath, [
      "diff",
      "--find-renames",
      "--unified=3",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      mergeBaseSha,
      headSha,
      "--",
      filePath
    ]);
  }

  async getDiffStat(repoPath: string, mergeBaseSha: string, headSha: string): Promise<string> {
    return this.runGit(repoPath, ["diff", "--stat=120,80", "--find-renames", mergeBaseSha, headSha]);
  }

  async getCombinedDiff(repoPath: string, mergeBaseSha: string, headSha: string): Promise<string> {
    return this.runGit(repoPath, [
      "diff",
      "--find-renames",
      "--unified=3",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      mergeBaseSha,
      headSha
    ]);
  }

  async getCommitSubjects(repoPath: string, mergeBaseSha: string, headSha: string): Promise<string[]> {
    const output = await this.runGit(repoPath, ["log", "--format=%s", `${mergeBaseSha}..${headSha}`]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async getWorkingTreeSnapshot(repoPath: string): Promise<WorkingTreeSnapshot> {
    const rootPath = await this.assertGitRepo(repoPath);
    const [status, stagedStat, unstagedStat, stagedDiff, unstagedDiff] = await Promise.all([
      this.runGit(rootPath, ["status", "--short", "--untracked-files=all"]),
      this.runGit(rootPath, ["diff", "--cached", "--stat=120,80", "--find-renames"]),
      this.runGit(rootPath, ["diff", "--stat=120,80", "--find-renames"]),
      this.runGit(rootPath, [
        "diff",
        "--cached",
        "--find-renames",
        "--unified=3",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/"
      ]),
      this.runGit(rootPath, [
        "diff",
        "--find-renames",
        "--unified=3",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/"
      ])
    ]);

    return {
      status,
      stagedStat,
      unstagedStat,
      stagedDiff,
      unstagedDiff
    };
  }

  async getWorkingTreeChangedFiles(repoPath: string, sessionId: string): Promise<ChangedFile[]> {
    const rootPath = await this.assertGitRepo(repoPath);
    const [statusOutput, numstatOutput, untrackedOutput] = await Promise.all([
      this.runGit(rootPath, ["diff", "--name-status", "--find-renames", "HEAD"]),
      this.runGit(rootPath, ["diff", "--numstat", "--find-renames", "HEAD"]),
      this.runGit(rootPath, ["ls-files", "--others", "--exclude-standard"])
    ]);

    const statusLines = statusOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => this.parseStatusLine(line));

    const numstatMap = new Map<string, ParsedNumstatLine>();
    for (const line of numstatOutput.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
      const parsed = this.parseNumstatLine(line);
      numstatMap.set(parsed.filePath, parsed);
    }

    const trackedFiles = statusLines.map((line, index) => {
      const stats = numstatMap.get(line.filePath) ?? { additions: 0, deletions: 0 };
      return {
        id: `working-tree:${sessionId}:${index}:${line.filePath}`,
        sessionId,
        source: "working-tree" as const,
        filePath: line.filePath,
        oldPath: line.oldPath,
        newPath: line.newPath,
        status: line.status,
        additions: stats.additions ?? null,
        deletions: stats.deletions ?? null,
        isBinary: stats.additions === null && stats.deletions === null
      };
    });

    const seenPaths = new Set(trackedFiles.map((file) => file.filePath));
    const untrackedFiles = untrackedOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !seenPaths.has(line))
      .map((filePath, index) => ({
        id: `working-tree:${sessionId}:untracked:${index}:${filePath}`,
        sessionId,
        source: "working-tree" as const,
        filePath,
        oldPath: null,
        newPath: filePath,
        status: "added" as const,
        additions: null,
        deletions: null,
        isBinary: false
      }));

    return [...trackedFiles, ...untrackedFiles];
  }

  async getWorkingTreeFileDiff(repoPath: string, filePath: string): Promise<string> {
    const rootPath = await this.assertGitRepo(repoPath);
    const trackedDiff = await this.runGit(rootPath, [
      "diff",
      "--find-renames",
      "--unified=3",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "HEAD",
      "--",
      filePath
    ]);

    if (trackedDiff.trim().length > 0) {
      return trackedDiff;
    }

    const absolutePath = path.join(rootPath, filePath);
    const fileContents = await fs.readFile(absolutePath);
    if (fileContents.includes(0)) {
      return "";
    }

    return this.runGit(rootPath, [
      "diff",
      "--no-index",
      "--unified=3",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--",
      "/dev/null",
      filePath
    ]).catch(() => "");
  }

  async stagePaths(repoPath: string, filePaths: string[]): Promise<void> {
    const rootPath = await this.assertGitRepo(repoPath);
    const uniquePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) {
      return;
    }

    const existingPaths = await Promise.all(uniquePaths.map(async (filePath) => {
      const absolutePath = path.join(rootPath, filePath);
      const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
      if (exists) {
        return filePath;
      }

      const tracked = await this.isTrackedPath(rootPath, filePath);
      return tracked ? filePath : null;
    }));

    const stageablePaths = existingPaths.filter((filePath): filePath is string => filePath !== null);
    if (stageablePaths.length === 0) {
      return;
    }

    await this.runGit(rootPath, ["add", "--all", "--", ...stageablePaths]);
  }

  async commit(repoPath: string, title: string, body: string): Promise<void> {
    const rootPath = await this.assertGitRepo(repoPath);
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      throw new Error("Codex returned an empty commit title.");
    }

    const args = trimmedBody.length > 0
      ? ["commit", "-m", trimmedTitle, "-m", trimmedBody]
      : ["commit", "-m", trimmedTitle];

    await this.runGit(rootPath, args);
  }

  async pushHead(repoPath: string): Promise<void> {
    const rootPath = await this.assertGitRepo(repoPath);
    await this.runGit(rootPath, ["push", "--set-upstream", "origin", "HEAD"]);
  }

  async createPullRequest(repoPath: string, title: string, body: string): Promise<string> {
    const rootPath = await this.assertGitRepo(repoPath);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Codex returned an empty PR title.");
    }

    return (await this.runCommand("gh", ["pr", "create", "--title", trimmedTitle, "--body", body], rootPath)).trim();
  }

  private async hasRef(repoPath: string, ref: string): Promise<boolean> {
    try {
      await this.runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`]);
      return true;
    } catch {
      try {
        await this.runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${ref}`]);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async getAheadCount(repoPath: string): Promise<number> {
    try {
      const upstream = (await this.runGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
      if (!upstream) {
        return 0;
      }

      const output = await this.runGit(repoPath, ["rev-list", "--count", `${upstream}..HEAD`]);
      const parsed = Number.parseInt(output.trim(), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private async isTrackedPath(repoPath: string, filePath: string): Promise<boolean> {
    try {
      await this.runGit(repoPath, ["ls-files", "--error-unmatch", "--", filePath]);
      return true;
    } catch {
      return false;
    }
  }

  private parseStatusLine(line: string): ParsedStatusLine {
    const parts = line.split("\t");
    const rawStatus = parts[0] ?? "M";
    const normalized = normalizeStatus(rawStatus);

    if (normalized === "renamed" || normalized === "copied") {
      const oldPath = parts[1] ?? "";
      const newPath = parts[2] ?? oldPath;
      return {
        status: normalized,
        filePath: newPath,
        oldPath,
        newPath
      };
    }

    const filePath = parts[1] ?? parts[0] ?? "";
    return {
      status: normalized,
      filePath,
      oldPath: normalized === "deleted" ? filePath : null,
      newPath: normalized === "added" ? filePath : normalized === "deleted" ? null : filePath
    };
  }

  private parseNumstatLine(line: string): ParsedNumstatLine {
    const parts = line.split("\t");
    const additionsRaw = parts[0] ?? "0";
    const deletionsRaw = parts[1] ?? "0";
    const pathPart = parts.at(-1) ?? "";

    return {
      filePath: pathPart,
      additions: additionsRaw === "-" ? null : Number.parseInt(additionsRaw, 10),
      deletions: deletionsRaw === "-" ? null : Number.parseInt(deletionsRaw, 10)
    };
  }

  private async runGit(repoPath: string, args: string[]): Promise<string> {
    return this.runCommand("git", args, repoPath);
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(command, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${command} ${args.join(" ")} failed in ${cwd}: ${message}`);
    }
  }
}

function normalizeStatus(rawStatus: string): FileStatus {
  const status = rawStatus[0] ?? "M";
  switch (status) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}
