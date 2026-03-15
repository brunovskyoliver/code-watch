import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import log from "electron-log/main";
import type { GitService } from "@main/services/git";
import { CodexAppServerService } from "@main/services/codex-app-server";
import type {
  ChangedFile,
  GitDraftAction,
  GitDraftResult,
  ReviewSessionDetail
} from "@shared/types";

const OPENCODE_VERSION_TIMEOUT_MS = 8_000;
const DEFAULT_OPENCODE_RUN_TIMEOUT_MS = 180_000;
const DEFAULT_OPENCODE_MODEL = "github-copilot/gemini-3-flash-preview";

function resolveOpenCodeRunTimeoutMs(): number {
  const raw = process.env.OPENCODE_RUN_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_OPENCODE_RUN_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OPENCODE_RUN_TIMEOUT_MS;
  }

  return parsed;
}

export class OpenCodeAppServerService extends CodexAppServerService {
  private readonly runTimeoutMs: number;
  private readonly model: string | null;

  constructor(git: GitService, dispatchEvent: (channel: string, payload: unknown) => void, executable = "opencode") {
    super(git, dispatchEvent, {
      executable,
      assistantLabel: "OpenCode",
      logPrefix: "opencode"
    });
    this.runTimeoutMs = resolveOpenCodeRunTimeoutMs();
    this.model = process.env.OPENCODE_MODEL?.trim() || null;
  }

  override async getStatus(): Promise<{ available: boolean; version: string | null; reason: string | null }> {
    try {
      const { stdout } = await promisify(execFile)("opencode", ["--version"], {
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
    const args = ["run", "--format", "json"];
    const model = await this.resolvePreferredModel();
    if (model) {
      args.push("--model", model);
    }
    args.push("--dir", input.cwd, input.prompt);
    const env = buildOpenCodeEnvironment(process.env, model);

    return this.runStructuredTurnStreaming(args, env);
  }

  override async draftGitArtifacts(input: {
    repoPath: string;
    session: ReviewSessionDetail;
    files: ChangedFile[];
    action: GitDraftAction;
  }): Promise<GitDraftResult> {
    return super.draftGitArtifacts(input);
  }

  private async runStructuredTurnStreaming(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      log.info("[opencode] run:spawn", {
        args,
        model: this.model,
        timeoutMs: this.runTimeoutMs
      });

      const child = spawn("opencode", args, {
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(
          `OpenCode run timed out after ${Math.round(this.runTimeoutMs / 1000)}s while drafting.` +
          (stderr ? ` OpenCode stderr: ${compactText(stderr)}` : "")
        ));
      }, this.runTimeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (process.env.OPENCODE_DEBUG === "1") {
          log.info("[opencode] run:stdout", compactText(chunk));
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (process.env.OPENCODE_DEBUG === "1") {
          log.warn("[opencode] run:stderr", compactText(chunk));
        }
      });

      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(`OpenCode run failed: ${error.message}`));
      });

      child.once("close", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        const text = extractOpenCodeText(stdout);
        if (!text) {
          reject(new Error(
            `OpenCode run did not return assistant text.` +
            (stdout ? ` stdout: ${compactText(stdout)}` : "") +
            (stderr ? ` stderr: ${compactText(stderr)}` : "")
          ));
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown parse error";
          reject(new Error(`OpenCode returned invalid JSON: ${message}`));
        }
      });
    });
  }

  private async resolvePreferredModel(): Promise<string | null> {
    // TODO: do i really want this?
    if (this.model) {
      return this.model;
    }

    try {
      const { stdout } = await promisify(execFile)("opencode", ["models", "--refresh"], {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      });
      const models = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes("/"));
      if (models.includes(DEFAULT_OPENCODE_MODEL)) {
        return DEFAULT_OPENCODE_MODEL;
      }
    } catch {
    }

    return null;
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

function getErrorText(error: unknown, key: "stderr" | "stdout"): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const value = (error as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    return "";
  }

  return compactText(value);
}

function buildOpenCodeEnvironment(baseEnv: NodeJS.ProcessEnv, model: string | null): NodeJS.ProcessEnv {
  const config = parseOpenCodeConfig(baseEnv.OPENCODE_CONFIG_CONTENT);

  const tools = {
    ...(isRecord(config.tools) ? config.tools : {}),
    bash: false,
    read: false,
    edit: false,
    write: false,
    grep: false,
    glob: false
  };

  const nextConfig: Record<string, unknown> = {
    ...config,
    share: config.share ?? "disabled",
    tools
  };

  if (model && nextConfig.model == null) {
    nextConfig.model = model;
  }

  return {
    ...baseEnv,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(nextConfig)
  };
}

function parseOpenCodeConfig(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 400);
}
