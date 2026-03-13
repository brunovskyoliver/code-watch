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
});
