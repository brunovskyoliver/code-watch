import { BrowserWindow, ipcMain } from "electron";
import { z, type ZodType } from "zod";
import type { ProjectService } from "@main/services/projects";
import type { ReviewService } from "@main/services/reviews";
import type { ThreadService } from "@main/services/threads";
import type { RepoWatcherRegistry } from "@main/watchers/repo-watcher";
import {
  changedFileSchema,
  paginatedCommentsSchema,
  paginatedFileDiffSchema,
  projectSummarySchema,
  reviewOpenResultSchema,
  reviewSessionDetailSchema,
  reviewSessionSummarySchema,
  threadAnchorSchema,
  threadPreviewSchema
} from "@shared/types";

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function validateOutput<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function registerIpcHandlers(services: {
  projects: ProjectService;
  reviews: ReviewService;
  threads: ThreadService;
  watchers: RepoWatcherRegistry;
}): void {
  ipcMain.handle("projects:pickDirectory", async () => validateOutput(z.string().nullable(), await services.projects.pickDirectory()));

  ipcMain.handle("projects:list", async () => validateOutput(z.array(projectSummarySchema), await services.projects.list()));

  ipcMain.handle("projects:add", async (_event, repoPath: string) => {
    const project = await services.projects.add(z.string().min(1).parse(repoPath));
    await services.watchers.watchProject(project.id, project.repoPath);
    return validateOutput(projectSummarySchema, project);
  });

  ipcMain.handle("projects:remove", async (_event, projectId: string) => {
    const id = z.string().min(1).parse(projectId);
    await services.watchers.unwatchProject(id);
    await services.projects.remove(id);
  });

  ipcMain.handle("projects:updateBaseBranch", async (_event, projectId: string, baseBranch: string) =>
    validateOutput(
      projectSummarySchema,
      await services.projects.updateBaseBranch(z.string().min(1).parse(projectId), z.string().min(1).parse(baseBranch))
    )
  );

  ipcMain.handle("reviews:open", async (_event, projectId: string, baseBranch?: string) =>
    validateOutput(
      reviewOpenResultSchema,
      await services.reviews.open(
        z.string().min(1).parse(projectId),
        baseBranch ? z.string().min(1).parse(baseBranch) : undefined
      )
    )
  );

  ipcMain.handle("reviews:list", async (_event, projectId: string) =>
    validateOutput(z.array(reviewSessionSummarySchema), await services.reviews.list(z.string().min(1).parse(projectId)))
  );
  ipcMain.handle("reviews:load", async (_event, sessionId: string) =>
    validateOutput(reviewSessionDetailSchema, await services.reviews.load(z.string().min(1).parse(sessionId)))
  );
  ipcMain.handle("reviews:files", async (_event, sessionId: string) =>
    validateOutput(z.array(changedFileSchema), await services.reviews.files(z.string().min(1).parse(sessionId)))
  );
  ipcMain.handle("reviews:diff", async (_event, sessionId: string, filePath: string, cursor?: string) =>
    validateOutput(
      paginatedFileDiffSchema,
      await services.reviews.diff(z.string().min(1).parse(sessionId), z.string().min(1).parse(filePath), cursor)
    )
  );

  ipcMain.handle("threads:listForFile", async (_event, sessionId: string, filePath: string) =>
    validateOutput(
      z.array(threadPreviewSchema),
      await services.threads.listForFile(z.string().min(1).parse(sessionId), z.string().min(1).parse(filePath))
    )
  );
  ipcMain.handle("threads:get", async (_event, threadId: string, cursor?: string) =>
    validateOutput(paginatedCommentsSchema, await services.threads.get(z.string().min(1).parse(threadId), cursor))
  );
  ipcMain.handle("threads:create", async (_event, anchor: unknown, body: string) =>
    validateOutput(threadPreviewSchema, await services.threads.create(threadAnchorSchema.parse(anchor), z.string().min(1).parse(body)))
  );
  ipcMain.handle("threads:addComment", async (_event, threadId: string, body: string) =>
    validateOutput(
      paginatedCommentsSchema,
      await services.threads.addComment(z.string().min(1).parse(threadId), z.string().min(1).parse(body))
    )
  );
  ipcMain.handle("threads:resolve", async (_event, threadId: string) =>
    validateOutput(threadPreviewSchema, await services.threads.resolve(z.string().min(1).parse(threadId)))
  );
  ipcMain.handle("threads:reopen", async (_event, threadId: string) =>
    validateOutput(threadPreviewSchema, await services.threads.reopen(z.string().min(1).parse(threadId)))
  );
}
