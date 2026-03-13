import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, FileStatus } from "@shared/types";

const execFileAsync = promisify(execFile);

export interface RepoState {
  rootPath: string;
  currentBranch: string | null;
  headSha: string | null;
  dirty: boolean;
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
    const [currentBranch, headSha, dirty] = await Promise.all([
      this.runGit(rootPath, ["branch", "--show-current"]).then((value) => value.trim() || null),
      this.runGit(rootPath, ["rev-parse", "HEAD"]).then((value) => value.trim()).catch(() => null),
      this.runGit(rootPath, ["status", "--porcelain=v1"]).then((value) => value.trim().length > 0)
    ]);

    return { rootPath, currentBranch, headSha, dirty };
  }

  async safeGetRepoState(repoPath: string): Promise<RepoState | null> {
    try {
      return await this.getRepoState(repoPath);
    } catch {
      return null;
    }
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
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: repoPath,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git ${args.join(" ")} failed in ${repoPath}: ${message}`);
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
