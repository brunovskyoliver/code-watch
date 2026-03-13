import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import log from "electron-log/main";
import { createDatabase } from "@main/db/client";
import { registerIpcHandlers, broadcast } from "@main/ipc";
import { GitService } from "@main/services/git";
import { ProjectService } from "@main/services/projects";
import { ReviewService } from "@main/services/reviews";
import { ThreadService } from "@main/services/threads";
import { RepoWatcherRegistry } from "@main/watchers/repo-watcher";

let mainWindow: BrowserWindow | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#111111",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/main_window/index.html"));
  }
}

async function bootstrap(): Promise<void> {
  log.initialize();
  log.errorHandler.startCatching();

  const { db } = createDatabase();
  const git = new GitService();
  const projects = new ProjectService(db, git);
  const reviews = new ReviewService(db, git, broadcast);
  const threads = new ThreadService(db);
  const watchers = new RepoWatcherRegistry(git, broadcast);

  registerIpcHandlers({ projects, reviews, threads, watchers });

  const projectRows = await projects.list();
  await watchers.primeExisting(projectRows.map((project) => ({ id: project.id, repoPath: project.repoPath })));

  app.on("before-quit", () => {
    void watchers.dispose();
  });

  await createMainWindow();
}

app.whenReady().then(() => {
  void bootstrap();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
