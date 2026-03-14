import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { App } from "electron";

export const CODE_WATCH_HOME_DIRECTORY = ".code-watch";

export function getCodeWatchPaths(homeDirectory = os.homedir()) {
  const userDataPath = path.join(homeDirectory, CODE_WATCH_HOME_DIRECTORY);
  return {
    userDataPath,
    sessionDataPath: path.join(userDataPath, "session"),
    keybindingsPath: path.join(userDataPath, "keybindings.json")
  };
}

export function configureAppDataPaths(app: Pick<App, "setPath">): ReturnType<typeof getCodeWatchPaths> {
  const paths = getCodeWatchPaths();
  fs.mkdirSync(paths.userDataPath, { recursive: true });
  fs.mkdirSync(paths.sessionDataPath, { recursive: true });
  app.setPath("userData", paths.userDataPath);
  app.setPath("sessionData", paths.sessionDataPath);
  return paths;
}
