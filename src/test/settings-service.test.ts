import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import { spawn } from "node:child_process";
import { SettingsService } from "@main/services/settings";

function createSpawnChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    once: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
    removeListener: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
    unref: () => void;
    exitCode: number | null;
  };
  emitter.unref = vi.fn();
  emitter.exitCode = null;
  return emitter;
}

describe("SettingsService", () => {
  const spawnMock = vi.mocked(spawn);
  const originalEditor = process.env.EDITOR;
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-watch-settings-"));
    spawnMock.mockReset();
  });

  afterEach(() => {
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("opens keybindings in Visual Studio Code first on macOS", async () => {
    process.env.EDITOR = "nvim";
    spawnMock.mockImplementation(() => {
      const child = createSpawnChild();
      setTimeout(() => {
        child.emit("close", 0);
      }, 0);
      return child as never;
    });

    const keybindingsPath = path.join(tempRoot, "keybindings.json");
    const service = new SettingsService(keybindingsPath, "darwin");

    await expect(service.openKeybindingsInEditor()).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "open",
      ["-a", "Visual Studio Code", keybindingsPath],
      expect.objectContaining({ shell: false, stdio: "ignore" })
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Cursor when Visual Studio Code is unavailable", async () => {
    delete process.env.EDITOR;
    let callCount = 0;
    spawnMock.mockImplementation(() => {
      const child = createSpawnChild();
      const currentCall = callCount;
      callCount += 1;
      setTimeout(() => {
        child.emit("close", currentCall === 0 ? 1 : 0);
      }, 0);
      return child as never;
    });

    const keybindingsPath = path.join(tempRoot, "keybindings.json");
    const service = new SettingsService(keybindingsPath, "darwin");

    await expect(service.openKeybindingsInEditor()).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "open",
      ["-a", "Visual Studio Code", keybindingsPath],
      expect.objectContaining({ shell: false, stdio: "ignore" })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "open",
      ["-a", "Cursor", keybindingsPath],
      expect.objectContaining({ shell: false, stdio: "ignore" })
    );
  });

  it("throws unsupported-editor error when VS Code and Cursor are unavailable", async () => {
    delete process.env.EDITOR;
    spawnMock.mockImplementation(() => {
      const child = createSpawnChild();
      setTimeout(() => {
        child.emit("close", 1);
      }, 0);
      return child as never;
    });

    const service = new SettingsService(path.join(tempRoot, "keybindings.json"), "darwin");

    await expect(service.openKeybindingsInEditor()).rejects.toThrow(
      "No supported editor found. Install Visual Studio Code or Cursor."
    );
  });

  it("throws when $EDITOR is missing on non-macOS", async () => {
    delete process.env.EDITOR;

    const service = new SettingsService(path.join(tempRoot, "keybindings.json"), "linux");

    await expect(service.openKeybindingsInEditor()).rejects.toThrow(
      "$EDITOR is not set. Please set EDITOR to open keybindings."
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when $EDITOR command exits before listeners attach on non-macOS", async () => {
    process.env.EDITOR = "missing-editor";
    spawnMock.mockImplementation(() => {
      const child = createSpawnChild();
      child.exitCode = 127;
      return child as never;
    });

    const service = new SettingsService(path.join(tempRoot, "keybindings.json"), "linux");

    await expect(service.openKeybindingsInEditor()).rejects.toThrow("Failed to open keybindings in $EDITOR");
  });
});
