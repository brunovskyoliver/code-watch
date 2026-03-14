import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import type { ProjectService } from "@main/services/projects";
import type { FileSearchService } from "@main/services/file-search";
import type { ReviewService } from "@main/services/reviews";
import type { SettingsService } from "@main/services/settings";
import type { ThreadService } from "@main/services/threads";
import type { RepoWatcherRegistry } from "@main/watchers/repo-watcher";
import { fileSearchResultSchema, threadAnchorSchema } from "@shared/types";
import { keybindingsSchema } from "@shared/keybindings";

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

export function registerIpcHandlers(services: {
  projects: ProjectService;
  search: FileSearchService;
  reviews: ReviewService;
  threads: ThreadService;
  settings: SettingsService;
  watchers: RepoWatcherRegistry;
}): void {
  ipcMain.handle("projects:pickDirectory", async () => services.projects.pickDirectory());

  ipcMain.handle("projects:list", async () => services.projects.list());

  ipcMain.handle("projects:reorder", async (_event, projectIds: string[]) =>
    services.projects.reorder(z.array(z.string().min(1)).parse(projectIds))
  );

  ipcMain.handle("projects:add", async (_event, repoPath: string) => {
    const project = await services.projects.add(z.string().min(1).parse(repoPath));
    await services.watchers.watchProject(project.id, project.repoPath);
    return project;
  });

  ipcMain.handle("projects:remove", async (_event, projectId: string) => {
    const id = z.string().min(1).parse(projectId);
    await services.watchers.unwatchProject(id);
    await services.projects.remove(id);
  });

  ipcMain.handle("projects:togglePin", async (_event, projectId: string) =>
    services.projects.togglePin(z.string().min(1).parse(projectId))
  );

  ipcMain.handle("projects:listBranches", async (_event, projectId: string) =>
    services.projects.listBranches(z.string().min(1).parse(projectId))
  );

  ipcMain.handle("projects:updateBaseBranch", async (_event, projectId: string, baseBranch: string) =>
    services.projects.updateBaseBranch(z.string().min(1).parse(projectId), z.string().min(1).parse(baseBranch))
  );

  ipcMain.handle("reviews:open", async (_event, projectId: string, baseBranch?: string) =>
    services.reviews.open(z.string().min(1).parse(projectId), baseBranch ? z.string().min(1).parse(baseBranch) : undefined)
  );

  ipcMain.handle("reviews:list", async (_event, projectId: string) => services.reviews.list(z.string().min(1).parse(projectId)));
  ipcMain.handle("reviews:load", async (_event, sessionId: string) => services.reviews.load(z.string().min(1).parse(sessionId)));
  ipcMain.handle("reviews:files", async (_event, sessionId: string) => services.reviews.files(z.string().min(1).parse(sessionId)));
  ipcMain.handle("reviews:diff", async (_event, sessionId: string, filePath: string) =>
    services.reviews.diff(z.string().min(1).parse(sessionId), z.string().min(1).parse(filePath))
  );

  ipcMain.handle("threads:listForFile", async (_event, sessionId: string, filePath: string) =>
    services.threads.listForFile(z.string().min(1).parse(sessionId), z.string().min(1).parse(filePath))
  );
  ipcMain.handle("threads:get", async (_event, threadId: string, cursor?: string) =>
    services.threads.get(z.string().min(1).parse(threadId), cursor)
  );
  ipcMain.handle("threads:create", async (_event, anchor: unknown, body: string) =>
    services.threads.create(threadAnchorSchema.parse(anchor), z.string().min(1).parse(body))
  );
  ipcMain.handle("threads:addComment", async (_event, threadId: string, body: string) =>
    services.threads.addComment(z.string().min(1).parse(threadId), z.string().min(1).parse(body))
  );
  ipcMain.handle("threads:resolve", async (_event, threadId: string) =>
    services.threads.resolve(z.string().min(1).parse(threadId))
  );
  ipcMain.handle("threads:reopen", async (_event, threadId: string) =>
    services.threads.reopen(z.string().min(1).parse(threadId))
  );

  ipcMain.handle("search:files", async (_event, query: string, limit?: number) => {
    const results = await services.search.files(
      z.string().max(200).parse(query),
      limit === undefined ? undefined : z.number().int().min(1).max(20).parse(limit)
    );
    return z.array(fileSearchResultSchema).parse(results);
  });

  ipcMain.handle("settings:loadKeybindings", async () => keybindingsSchema.parse(await services.settings.loadKeybindings()));

  ipcMain.handle("settings:openKeybindingsInEditor", async () => {
    await services.settings.openKeybindingsInEditor();
  });

  ipcMain.handle("settings:reset", async () => {
    await services.settings.reset();
  });
}
