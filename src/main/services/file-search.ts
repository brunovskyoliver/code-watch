import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@main/db/client";
import { projectsTable, reviewSessionsTable, sessionFilesTable } from "@main/db/schema";
import type { GitService } from "@main/services/git";
import type { FileSearchResult } from "@shared/types";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const PROJECT_FILE_CACHE_TTL_MS = 5_000;

interface SearchCandidate extends FileSearchResult {
  projectRank: number;
  sortKey: number;
}

interface ProjectFileCacheEntry {
  sessionId: string;
  files: Array<{ filePath: string; sortKey: number }>;
  cachedAt: number;
}

export class FileSearchService {
  private readonly projectFilesCache = new Map<string, ProjectFileCacheEntry>();

  constructor(
    private readonly db: AppDatabase,
    private readonly git: GitService
  ) {}

  async files(query: string, requestedLimit?: number, activeProjectId?: string | null): Promise<FileSearchResult[]> {
    const normalizedQuery = query.trim();
    const limit = normalizeLimit(requestedLimit);
    if (limit <= 0) {
      return [];
    }

    const projects = await this.db.select().from(projectsTable).orderBy(desc(projectsTable.lastOpenedAt));
    const projectsToSearch = activeProjectId ? projects.filter((project) => project.id === activeProjectId) : projects;

    const candidateGroups = await Promise.all(
      projectsToSearch.map((project, projectRank) => this.loadProjectCandidates(project.id, project.name, projectRank))
    );
    const candidates = candidateGroups.flat();

    if (!normalizedQuery) {
      return candidates
        .sort((left, right) => left.projectRank - right.projectRank || left.sortKey - right.sortKey)
        .slice(0, limit)
        .map(stripSearchCandidateMeta);
    }

    const ranked = candidates
      .map((candidate) => {
        const score = scoreFilePathMatch(normalizedQuery, candidate.filePath);
        return score === null ? null : { candidate, score };
      })
      .filter((entry): entry is { candidate: SearchCandidate; score: number } => entry !== null)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.candidate.projectRank !== right.candidate.projectRank) {
          return left.candidate.projectRank - right.candidate.projectRank;
        }
        if (left.candidate.filePath.length !== right.candidate.filePath.length) {
          return left.candidate.filePath.length - right.candidate.filePath.length;
        }
        return left.candidate.filePath.localeCompare(right.candidate.filePath);
      })
      .slice(0, limit)
      .map((entry) => stripSearchCandidateMeta(entry.candidate));

    return ranked;
  }

  private async loadProjectCandidates(projectId: string, projectName: string, projectRank: number): Promise<SearchCandidate[]> {
    const project = await this.db.query.projectsTable.findFirst({
      where: eq(projectsTable.id, projectId)
    });
    if (!project) {
      this.projectFilesCache.delete(projectId);
      return [];
    }

    const latestSession = await this.db.query.reviewSessionsTable.findFirst({
      where: eq(reviewSessionsTable.projectId, projectId),
      orderBy: desc(reviewSessionsTable.lastOpenedAt)
    });

    if (!latestSession) {
      this.projectFilesCache.delete(projectId);
      return [];
    }

    const now = Date.now();
    const cached = this.projectFilesCache.get(projectId);
    const cachedFiles =
      cached && cached.sessionId === latestSession.id && now - cached.cachedAt < PROJECT_FILE_CACHE_TTL_MS
        ? cached.files
        : null;

    const files =
      cachedFiles ??
      (await this.db.query.sessionFilesTable.findMany({
        where: eq(sessionFilesTable.sessionId, latestSession.id),
        orderBy: asc(sessionFilesTable.sortKey)
      })).map((file) => ({ filePath: file.filePath, sortKey: file.sortKey }));

    if (!cachedFiles) {
      this.projectFilesCache.set(projectId, {
        sessionId: latestSession.id,
        files,
        cachedAt: now
      });
    }

    const workingTreeFiles = await this.git
      .getWorkingTreeChangedFiles(project.repoPath, latestSession.id)
      .catch(() => []);

    const workingTreePaths = new Set(workingTreeFiles.map((file) => file.filePath));
    const mergedFiles = [
      ...workingTreeFiles.map((file, index) => ({ filePath: file.filePath, sortKey: -1000 + index })),
      ...files.filter((file) => !workingTreePaths.has(file.filePath))
    ];

    return mergedFiles.map((file) => ({
      projectId,
      projectName,
      sessionId: latestSession.id,
      filePath: file.filePath,
      projectRank,
      sortKey: file.sortKey
    }));
  }
}

function normalizeLimit(limit: number | undefined): number {
  const parsed = typeof limit === "number" ? Math.trunc(limit) : DEFAULT_SEARCH_LIMIT;
  return clamp(parsed, 1, MAX_SEARCH_LIMIT);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function stripSearchCandidateMeta(candidate: SearchCandidate): FileSearchResult {
  return {
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    sessionId: candidate.sessionId,
    filePath: candidate.filePath
  };
}

export function scoreFilePathMatch(query: string, targetPath: string): number | null {
  const normalizedQuery = query.toLowerCase();
  const normalizedTarget = targetPath.toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  const fileName = normalizedTarget.split("/").at(-1) ?? normalizedTarget;

  let score = 0;
  if (normalizedTarget === normalizedQuery) {
    score += 500;
  }
  if (fileName === normalizedQuery) {
    score += 420;
  }
  if (fileName.startsWith(normalizedQuery)) {
    score += 240;
  }
  if (normalizedTarget.startsWith(normalizedQuery)) {
    score += 180;
  }
  if (fileName.includes(normalizedQuery)) {
    score += 120;
  }
  if (normalizedTarget.includes(normalizedQuery)) {
    score += 80;
  }

  let searchStart = 0;
  let previousMatchIndex = -1;

  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, searchStart);
    if (index === -1) {
      return null;
    }

    score += 12;
    if (index === previousMatchIndex + 1) {
      score += 18;
    }

    const previousChar = index > 0 ? normalizedTarget[index - 1] : "/";
    if (previousChar === "/" || previousChar === "_" || previousChar === "-" || previousChar === ".") {
      score += 16;
    }

    if (index <= 10) {
      score += 10 - index;
    }

    if (previousMatchIndex >= 0) {
      score -= Math.max(0, index - previousMatchIndex - 1);
    }

    previousMatchIndex = index;
    searchStart = index + 1;
  }

  score += Math.round((normalizedQuery.length / normalizedTarget.length) * 40);
  return score;
}
