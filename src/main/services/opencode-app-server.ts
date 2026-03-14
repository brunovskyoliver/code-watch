import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitService } from "@main/services/git";
import { CodexAppServerService } from "@main/services/codex-app-server";
import type {
  ChangedFile,
  GitDraftAction,
  GitDraftResult,
  ReviewSessionDetail
} from "@shared/types";

const OPENCODE_VERSION_TIMEOUT_MS = 8_000;
const OPENCODE_RUN_TIMEOUT_MS = 60_000;

export class OpenCodeAppServerService extends CodexAppServerService {
  private readonly runExecFile: typeof execFile;

  constructor(git: GitService, dispatchEvent: (channel: string, payload: unknown) => void, executable = "opencode") {
    super(git, dispatchEvent, {
      executable,
      assistantLabel: "OpenCode",
      logPrefix: "opencode"
    });
    this.runExecFile = execFile;
  }

  override async getStatus(): Promise<{ available: boolean; version: string | null; reason: string | null }> {
    try {
      const { stdout } = await promisify(this.runExecFile)("opencode", ["--version"], {
        timeout: OPENCODE_VERSION_TIMEOUT_MS,
        windowsHide: true
      });
      const version = stdout.trim() || "unknown";
      return { available: true, version, reason: null };
    } catch (error) {
      return {
        available: false,
        version: null,
        reason: error instanceof Error ? error.message : "OpenCode CLI is unavailable."
      };
    }
  }

  protected override async runStructuredTurn(input: { cwd: string; prompt: string }): Promise<unknown> {
    let stdout: string;
    try {
      const result = await promisify(this.runExecFile)("opencode", [
        "run",
        "--format",
        "json",
        "--dir",
        input.cwd,
        input.prompt
      ], {
        timeout: OPENCODE_RUN_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      stdout = result.stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OpenCode error";
      if (typeof message === "string" && message.toLowerCase().includes("timed out")) {
        throw new Error("OpenCode run timed out while drafting. Check provider auth/model config or try again.");
      }
      throw new Error(`OpenCode run failed: ${message}`);
    }

    const text = extractOpenCodeText(stdout);
    if (!text) {
      throw new Error("OpenCode run did not return assistant text.");
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      throw new Error(`OpenCode returned invalid JSON: ${message}`);
    }
  }

  override async draftGitArtifacts(input: {
    repoPath: string;
    session: ReviewSessionDetail;
    files: ChangedFile[];
    action: GitDraftAction;
  }): Promise<GitDraftResult> {
    return super.draftGitArtifacts(input);
  }
}

function extractOpenCodeText(stdout: string): string | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let lastText: string | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: {
          type?: string;
          text?: string;
        };
      };
      if (event.type === "text" && event.part?.type === "text" && typeof event.part.text === "string") {
        lastText = event.part.text;
      }
    } catch {
      continue;
    }
  }

  return lastText;
}
