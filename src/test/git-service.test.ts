import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitService } from "@main/services/git";

describe("GitService", () => {
  it("normalizes a repo root and falls back to main when no remote HEAD exists", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-watch-git-"));
    const repoPath = path.join(tempRoot, "repo");
    mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "code-watch@example.com"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Code Watch"], { cwd: repoPath });
    writeFileSync(path.join(repoPath, "README.md"), "# demo\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });

    const nestedPath = path.join(repoPath, "src");
    mkdirSync(nestedPath);

    const git = new GitService();
    await expect(git.assertGitRepo(nestedPath)).resolves.toBe(realpathSync(repoPath));
    await expect(git.detectBaseBranch(repoPath)).resolves.toBe("main");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("lists local and remote branches without remote HEAD aliases", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-watch-git-"));
    const repoPath = path.join(tempRoot, "repo");
    const remotePath = path.join(tempRoot, "remote.git");

    mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "code-watch@example.com"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Code Watch"], { cwd: repoPath });
    writeFileSync(path.join(repoPath, "README.md"), "# demo\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
    execFileSync("git", ["branch", "feature/demo"], { cwd: repoPath });
    execFileSync("git", ["init", "--bare", remotePath]);
    execFileSync("git", ["remote", "add", "origin", remotePath], { cwd: repoPath });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repoPath });

    const git = new GitService();
    const branches = await git.listBranches(repoPath);
    expect(branches).toContain("main");
    expect(branches).toContain("feature/demo");
    expect(branches).toContain("origin/main");
    expect(branches.some((branch) => branch.endsWith("/HEAD"))).toBe(false);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("stages tracked deletions but skips missing untracked paths", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-watch-git-"));
    const repoPath = path.join(tempRoot, "repo");
    mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "code-watch@example.com"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Code Watch"], { cwd: repoPath });

    const trackedPath = path.join(repoPath, "tracked.txt");
    writeFileSync(trackedPath, "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
    rmSync(trackedPath);

    const git = new GitService();
    await expect(git.stagePaths(repoPath, ["tracked.txt", "t"])).resolves.toBeUndefined();

    const status = execFileSync("git", ["status", "--short"], { cwd: repoPath, encoding: "utf8" });
    expect(status).toContain("D  tracked.txt");
    expect(status).not.toContain("fatal");

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
