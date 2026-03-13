import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@main/db/client";
import { projectsTable, reviewSessionsTable, sessionFilesTable } from "@main/db/schema";
import { GitService } from "@main/services/git";
import { parseUnifiedDiff } from "@main/services/diff-parser";
import { createId, now } from "@main/services/utils";
import type {
  ChangedFile,
  FileDiff,
  ProjectSummary,
  ReviewOpenResult,
  ReviewSessionDetail,
  ReviewSessionSummary
} from "@shared/types";

type EventDispatcher = (channel: string, payload: unknown) => void;

interface DiffCacheEntry {
  value: FileDiff;
  at: number;
}

export class ReviewService {
  private readonly diffCache = new Map<string, DiffCacheEntry>();

  constructor(
    private readonly db: AppDatabase,
    private readonly git: GitService,
    private readonly dispatchEvent: EventDispatcher
  ) {}

  async open(projectId: string, requestedBaseBranch?: string): Promise<ReviewOpenResult> {
    const project = await this.requireProject(projectId);
    const repoState = await this.git.getRepoState(project.repoPath);
    if (!repoState.currentBranch || !repoState.headSha) {
      throw new Error("The selected repository is not currently on a local branch.");
    }

    const baseBranch = requestedBaseBranch ?? project.defaultBaseBranch;
    const [baseSha, mergeBaseSha] = await Promise.all([
      this.git.getCommitSha(project.repoPath, baseBranch),
      this.git.getMergeBase(project.repoPath, baseBranch)
    ]);

    const sessions = await this.db.query.reviewSessionsTable.findMany({
      where: eq(reviewSessionsTable.projectId, projectId),
      orderBy: desc(reviewSessionsTable.lastOpenedAt)
    });

    const matchingExisting =
      sessions.find(
        (session) =>
          session.branchName === repoState.currentBranch &&
          session.baseBranch === baseBranch &&
          session.headSha === repoState.headSha
      ) ?? null;

    if (matchingExisting) {
      this.db
        .update(reviewSessionsTable)
        .set({ lastOpenedAt: now() })
        .where(eq(reviewSessionsTable.id, matchingExisting.id))
        .run();

      return {
        created: false,
        detail: await this.load(matchingExisting.id)
      };
    }

    const sessionId = createId("session");
    const timestamp = now();

    this.db.insert(reviewSessionsTable).values({
      id: sessionId,
      projectId,
      branchName: repoState.currentBranch,
      baseBranch,
      headSha: repoState.headSha,
      baseSha,
      mergeBaseSha,
      createdAt: timestamp,
      lastOpenedAt: timestamp
    }).run();

    const files = await this.git.getChangedFiles(project.repoPath, mergeBaseSha, repoState.headSha, sessionId);
    if (files.length > 0) {
      this.db.insert(sessionFilesTable).values(
        files.map((file, index) => ({
          id: createId("file"),
          sessionId,
          filePath: file.filePath,
          oldPath: file.oldPath,
          newPath: file.newPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          isBinary: file.isBinary,
          sortKey: index
        }))
      ).run();
    }

    this.dispatchEvent("review.sessionCreated", { projectId, sessionId });

    return {
      created: true,
      detail: await this.load(sessionId)
    };
  }

  async list(projectId: string): Promise<ReviewSessionSummary[]> {
    const sessions = await this.db.query.reviewSessionsTable.findMany({
      where: eq(reviewSessionsTable.projectId, projectId),
      orderBy: desc(reviewSessionsTable.lastOpenedAt)
    });

    return sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      branchName: session.branchName,
      baseBranch: session.baseBranch,
      headSha: session.headSha,
      baseSha: session.baseSha,
      mergeBaseSha: session.mergeBaseSha,
      createdAt: session.createdAt,
      lastOpenedAt: session.lastOpenedAt
    }));
  }

  async load(sessionId: string): Promise<ReviewSessionDetail> {
    const session = await this.db.query.reviewSessionsTable.findFirst({
      where: eq(reviewSessionsTable.id, sessionId)
    });

    if (!session) {
      throw new Error("Review session not found.");
    }

    const project = await this.requireProject(session.projectId);
    const summary = await this.toProjectSummary(project);
    return {
      session: {
        id: session.id,
        projectId: session.projectId,
        branchName: session.branchName,
        baseBranch: session.baseBranch,
        headSha: session.headSha,
        baseSha: session.baseSha,
        mergeBaseSha: session.mergeBaseSha,
        createdAt: session.createdAt,
        lastOpenedAt: session.lastOpenedAt
      },
      project: summary,
      dirty: summary.dirty
    };
  }

  async files(sessionId: string): Promise<ChangedFile[]> {
    const files = await this.db.query.sessionFilesTable.findMany({
      where: eq(sessionFilesTable.sessionId, sessionId),
      orderBy: asc(sessionFilesTable.sortKey)
    });

    return files.map((file) => ({
      id: file.id,
      sessionId: file.sessionId,
      filePath: file.filePath,
      oldPath: file.oldPath,
      newPath: file.newPath,
      status: file.status as ChangedFile["status"],
      additions: file.additions,
      deletions: file.deletions,
      isBinary: file.isBinary
    }));
  }

  async diff(sessionId: string, filePath: string): Promise<FileDiff> {
    const cacheKey = `${sessionId}:${filePath}`;
    const cached = this.diffCache.get(cacheKey);
    if (cached) {
      return cached.value;
    }

    const session = await this.db.query.reviewSessionsTable.findFirst({
      where: eq(reviewSessionsTable.id, sessionId)
    });
    if (!session) {
      throw new Error("Review session not found.");
    }

    const project = await this.requireProject(session.projectId);
    const file = await this.db.query.sessionFilesTable.findFirst({
      where: and(eq(sessionFilesTable.sessionId, sessionId), eq(sessionFilesTable.filePath, filePath))
    });

    if (!file) {
      throw new Error("Changed file not found.");
    }

    const diffText = await this.git.getFileDiff(project.repoPath, session.mergeBaseSha, session.headSha, filePath);
    const value = parseUnifiedDiff(diffText, {
      filePath,
      oldPath: file.oldPath,
      newPath: file.newPath,
      status: file.status as ChangedFile["status"],
      additions: file.additions,
      deletions: file.deletions
    });

    this.diffCache.set(cacheKey, { value, at: Date.now() });
    if (this.diffCache.size > 150) {
      const oldestKey = this.diffCache.entries().next().value?.[0];
      if (oldestKey) {
        this.diffCache.delete(oldestKey);
      }
    }

    return value;
  }

  private async requireProject(projectId: string) {
    const project = await this.db.query.projectsTable.findFirst({
      where: eq(projectsTable.id, projectId)
    });

    if (!project) {
      throw new Error("Project not found.");
    }

    return project;
  }

  private async toProjectSummary(project: typeof projectsTable.$inferSelect): Promise<ProjectSummary> {
    const state = await this.git.safeGetRepoState(project.repoPath);
    return {
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      defaultBaseBranch: project.defaultBaseBranch,
      createdAt: project.createdAt,
      lastOpenedAt: project.lastOpenedAt,
      currentBranch: state?.currentBranch ?? null,
      headSha: state?.headSha ?? null,
      dirty: state?.dirty ?? false
    };
  }
}
