import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import type { AppDatabase } from "@main/db/client";
import { assistantProviderSchema, userSettingsSchema, DEFAULT_USER_SETTINGS, type AssistantProvider, type AssistantSettings, type UserSettings } from "@shared/types";
import { settingsTable } from "@main/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_KEYBINDINGS, keybindingsSchema, type Keybinding } from "@shared/keybindings";

const ASSISTANT_PROVIDER_KEY = "assistant.provider";
const DEFAULT_ASSISTANT_PROVIDER: AssistantProvider = "codex";
type EventDispatcher = (channel: string, payload: unknown) => void;

export class SettingsService {
  private userSettingsWatcher: FSWatcher | null = null;
  private userSettingsWatchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly keybindingsPath: string,
    private readonly userSettingsPath: string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async loadKeybindings(): Promise<Keybinding[]> {
    const existing = await this.readKeybindingsFile();
    if (existing) {
      return existing;
    }

    await this.writeKeybindingsFile(DEFAULT_KEYBINDINGS);
    return [...DEFAULT_KEYBINDINGS];
  }

  async openKeybindingsInEditor(): Promise<void> {
    await this.loadKeybindings();

    if (this.platform === "darwin") {
      await this.openInPreferredMacEditor(this.keybindingsPath);
      return;
    }

    const editor = process.env.EDITOR?.trim();
    if (editor) {
      const command = `${editor} "${this.escapeForDoubleQuotes(this.keybindingsPath)}"`;
      await this.spawnAndVerify(command, {
        shell: true,
        missingEditorMessage: "Failed to open keybindings in $EDITOR"
      });
      return;
    }

    throw new Error("$EDITOR is not set. Please set EDITOR to open keybindings.");
  }

  async loadUserSettings(): Promise<UserSettings> {
    const existing = await this.readUserSettingsFile();
    if (existing) {
      return existing;
    }

    await this.writeUserSettingsFile(DEFAULT_USER_SETTINGS);
    return { ...DEFAULT_USER_SETTINGS };
  }

  async saveUserSettings(settings: UserSettings): Promise<UserSettings> {
    const validated = userSettingsSchema.parse(settings);
    await this.writeUserSettingsFile(validated);
    return validated;
  }

  async openUserSettingsInEditor(): Promise<void> {
    await this.loadUserSettings();

    if (this.platform === "darwin") {
      await this.openInPreferredMacEditor(this.userSettingsPath);
      return;
    }

    const editor = process.env.EDITOR?.trim();
    if (editor) {
      const command = `${editor} "${this.escapeForDoubleQuotes(this.userSettingsPath)}"`;
      await this.spawnAndVerify(command, {
        shell: true,
        missingEditorMessage: "Failed to open settings in $EDITOR"
      });
      return;
    }

    throw new Error("$EDITOR is not set. Please set EDITOR to open settings.");
  }

  async reset(): Promise<void> {
    await this.writeKeybindingsFile(DEFAULT_KEYBINDINGS);
    await this.writeUserSettingsFile(DEFAULT_USER_SETTINGS);
    await this.saveAssistantProvider(DEFAULT_ASSISTANT_PROVIDER);
  }

  async watchUserSettings(dispatchEvent: EventDispatcher): Promise<void> {
    if (this.userSettingsWatcher) {
      return;
    }

    await this.loadUserSettings();

    const scheduleEmit = () => {
      if (this.userSettingsWatchTimer) {
        clearTimeout(this.userSettingsWatchTimer);
      }

      this.userSettingsWatchTimer = setTimeout(() => {
        void this.loadUserSettings()
          .then((settings) => {
            dispatchEvent("settings.userSettingsChanged", settings);
          })
          .catch(() => {
          });
      }, 120);
    };

    this.userSettingsWatcher = chokidar.watch(this.userSettingsPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 25
      }
    });

    this.userSettingsWatcher.on("add", scheduleEmit);
    this.userSettingsWatcher.on("change", scheduleEmit);
  }

  async dispose(): Promise<void> {
    if (this.userSettingsWatchTimer) {
      clearTimeout(this.userSettingsWatchTimer);
      this.userSettingsWatchTimer = null;
    }

    if (!this.userSettingsWatcher) {
      return;
    }

    const watcher = this.userSettingsWatcher;
    this.userSettingsWatcher = null;
    await watcher.close();
  }

  async loadAssistantSettings(): Promise<AssistantSettings> {
    const row = this.db.select().from(settingsTable).where(eq(settingsTable.key, ASSISTANT_PROVIDER_KEY)).get();
    const parsed = assistantProviderSchema.safeParse(row?.value);
    return { provider: parsed.success ? parsed.data : DEFAULT_ASSISTANT_PROVIDER };
  }

  async saveAssistantProvider(provider: AssistantProvider): Promise<AssistantSettings> {
    const parsedProvider = assistantProviderSchema.parse(provider);
    this.db
      .insert(settingsTable)
      .values({ key: ASSISTANT_PROVIDER_KEY, value: parsedProvider })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: parsedProvider }
      })
      .run();

    return { provider: parsedProvider };
  }

  private async readKeybindingsFile(): Promise<Keybinding[] | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.keybindingsPath, "utf8");
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      const result = keybindingsSchema.safeParse(parsed);
      if (!result.success) {
        return null;
      }
      return result.data;
    } catch {
      return null;
    }
  }

  private async writeKeybindingsFile(keybindings: readonly Keybinding[]): Promise<void> {
    await fs.writeFile(this.keybindingsPath, `${JSON.stringify(keybindings, null, 2)}\n`, "utf8");
  }

  private async readUserSettingsFile(): Promise<UserSettings | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.userSettingsPath, "utf8");
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(stripJsoncLineComments(raw));
      const result = userSettingsSchema.safeParse(parsed);
      if (!result.success) {
        return null;
      }
      return result.data;
    } catch {
      return null;
    }
  }

  private async writeUserSettingsFile(settings: UserSettings): Promise<void> {
    const content = [
      "{",
      `  \"fileSearchDepth\": \"${settings.fileSearchDepth}\"\t// options: \"global\" | \"project\"`,
      "}",
      ""
    ].join("\n");
    await fs.writeFile(this.userSettingsPath, content, "utf8");
  }

  private escapeForDoubleQuotes(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private async openInPreferredMacEditor(filePath: string): Promise<void> {
    const preferredEditors = ["Visual Studio Code", "Cursor"];

    for (const editorName of preferredEditors) {
      try {
        await this.spawnAndVerify("open", {
          args: ["-a", editorName, filePath],
          missingEditorMessage: `Failed to open file in ${editorName}`
        });
        return;
      } catch {
      }
    }

    throw new Error("No supported editor found. Install Visual Studio Code or Cursor.");
  }

  private spawnAndVerify(
    command: string,
    options: {
      shell?: boolean;
      args?: string[];
      missingEditorMessage: string;
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, options.args ?? [], {
        shell: options.shell ?? false,
        stdio: "ignore"
      });

      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
        callback();
      };

      const onError = (error: Error) => {
        settle(() => reject(new Error(`${options.missingEditorMessage}: ${error.message}`)));
      };

      const onClose = (code: number | null) => {
        if (code === 0) {
          settle(resolve);
          return;
        }
        settle(() => reject(new Error(`${options.missingEditorMessage}.`)));
      };

      const timeout = setTimeout(() => {
        child.unref();
        settle(resolve);
      }, 1500);

      child.once("error", onError);
      child.once("close", onClose);

      if (child.exitCode !== null) {
        onClose(child.exitCode);
      }
    });
  }
}

function stripJsoncLineComments(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      let inString = false;
      let escaped = false;

      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const nextChar = index + 1 < line.length ? line[index + 1] : "";

        if (!inString && char === "/" && nextChar === "/") {
          return line.slice(0, index);
        }

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
        }
      }

      return line;
    })
    .join("\n");
}
