import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import { dialog } from "electron";
import type { AppDatabase } from "@main/db/client";
import { projectsTable } from "@main/db/schema";
import { createId, now } from "@main/services/utils";
import { GitService } from "@main/services/git";
import type { ProjectSummary } from "@shared/types";

export class ProjectService {
  constructor(
    private readonly db: AppDatabase,
    private readonly git: GitService
  ) {}

  async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Add a Git repository"
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.db.select().from(projectsTable).orderBy(asc(projectsTable.sortOrder));

    const states = await Promise.all(projects.map(async (project) => ({
      projectId: project.id,
      state: await this.git.safeGetRepoState(project.repoPath)
    })));

    return projects.map((project) => {
      const state = states.find((entry) => entry.projectId === project.id)?.state ?? null;
      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        defaultBaseBranch: project.defaultBaseBranch,
        sortOrder: project.sortOrder,
        isPinned: project.isPinned,
        createdAt: project.createdAt,
        lastOpenedAt: project.lastOpenedAt,
        currentBranch: state?.currentBranch ?? null,
        headSha: state?.headSha ?? null,
        dirty: state?.dirty ?? false,
        aheadCount: state?.aheadCount ?? 0
      };
    });
  }

  async getById(projectId: string) {
    const project = await this.db.query.projectsTable.findFirst({
      where: eq(projectsTable.id, projectId)
    });

    if (!project) {
      throw new Error("Project not found.");
    }

    return project;
  }

  async add(repoPath: string): Promise<ProjectSummary> {
    const rootPath = await this.git.assertGitRepo(repoPath);
    const existing = await this.db.query.projectsTable.findFirst({
      where: eq(projectsTable.repoPath, rootPath)
    });

    if (existing) {
      await this.touch(existing.id);
      return this.toSummary(await this.getById(existing.id));
    }

    const projectId = createId("project");
    const timestamp = now();
    const defaultBaseBranch = await this.git.detectBaseBranch(rootPath);
    const currentTail = await this.db
      .select({ sortOrder: projectsTable.sortOrder })
      .from(projectsTable)
      .orderBy(desc(projectsTable.sortOrder))
      .limit(1);
    const nextSortOrder = (currentTail[0]?.sortOrder ?? 0) + 1;

    this.db.insert(projectsTable).values({
      id: projectId,
      name: path.basename(rootPath),
      repoPath: rootPath,
      defaultBaseBranch,
      sortOrder: nextSortOrder,
      createdAt: timestamp,
      lastOpenedAt: timestamp
    }).run();

    return this.toSummary(await this.getById(projectId));
  }

  async reorder(projectIds: string[]): Promise<ProjectSummary[]> {
    const projects = await this.db.select().from(projectsTable);
    if (projectIds.length !== projects.length) {
      throw new Error("Project order update must include every project.");
    }

    const projectIdSet = new Set(projects.map((project) => project.id));
    if (projectIdSet.size !== projectIds.length) {
      throw new Error("Project order contains duplicate entries.");
    }

    for (const projectId of projectIds) {
      if (!projectIdSet.has(projectId)) {
        throw new Error("Project order contains unknown project IDs.");
      }
    }

    this.db.transaction((tx) => {
      for (const [index, projectId] of projectIds.entries()) {
        tx
          .update(projectsTable)
          .set({ sortOrder: index + 1 })
          .where(eq(projectsTable.id, projectId))
          .run();
      }
    });

    return this.list();
  }

  async remove(projectId: string): Promise<void> {
    this.db.delete(projectsTable).where(eq(projectsTable.id, projectId)).run();
  }

  async listBranches(projectId: string): Promise<string[]> {
    const project = await this.getById(projectId);
    return this.git.listBranches(project.repoPath);
  }

  async updateBaseBranch(projectId: string, baseBranch: string): Promise<ProjectSummary> {
    const project = await this.getById(projectId);
    await this.git.getCommitSha(project.repoPath, baseBranch);

    this.db
      .update(projectsTable)
      .set({
        defaultBaseBranch: baseBranch,
        lastOpenedAt: now()
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    return this.toSummary(await this.getById(projectId));
  }

  async togglePin(projectId: string): Promise<ProjectSummary> {
    const project = await this.getById(projectId);
    this.db
      .update(projectsTable)
      .set({ isPinned: !project.isPinned })
      .where(eq(projectsTable.id, projectId))
      .run();
    return this.toSummary(await this.getById(projectId));
  }

  async touch(projectId: string): Promise<void> {
    this.db.update(projectsTable).set({ lastOpenedAt: now() }).where(eq(projectsTable.id, projectId)).run();
  }

  private async toSummary(project: typeof projectsTable.$inferSelect): Promise<ProjectSummary> {
    const state = await this.git.safeGetRepoState(project.repoPath);
    return {
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      defaultBaseBranch: project.defaultBaseBranch,
      sortOrder: project.sortOrder,
      isPinned: project.isPinned,
      createdAt: project.createdAt,
      lastOpenedAt: project.lastOpenedAt,
      currentBranch: state?.currentBranch ?? null,
      headSha: state?.headSha ?? null,
      dirty: state?.dirty ?? false,
      aheadCount: state?.aheadCount ?? 0
    };
  }
}
