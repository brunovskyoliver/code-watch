import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { DEFAULT_KEYBINDINGS, keybindingsSchema, type Keybinding } from "@shared/keybindings";

export class SettingsService {
  constructor(private readonly keybindingsPath: string) {}

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

    const editor = process.env.EDITOR?.trim();
    if (!editor) {
      throw new Error("$EDITOR is not set. Please set EDITOR to open keybindings.");
    }

    const command = `${editor} "${this.escapeForDoubleQuotes(this.keybindingsPath)}"`;
    const child = spawn(command, {
      shell: true,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  }

  async reset(): Promise<void> {
    await this.writeKeybindingsFile(DEFAULT_KEYBINDINGS);
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

  private escapeForDoubleQuotes(value: string): string {
    return value.replace(/"/g, '\\"');
  }
}
