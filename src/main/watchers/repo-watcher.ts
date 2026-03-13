import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { GitService, RepoState } from "@main/services/git";
import type { RepoStateEvent } from "@shared/types";

type EventDispatcher = (channel: string, payload: unknown) => void;

interface WatchEntry {
  watcher: FSWatcher;
  state: RepoState | null;
}

const IGNORED_DIRECTORIES = /(^|[/\\])(?:node_modules|dist|build|coverage|out|\.next)([/\\]|$)/;

export class RepoWatcherRegistry {
  private readonly watchers = new Map<string, WatchEntry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly git: GitService,
    private readonly dispatchEvent: EventDispatcher
  ) {}

  async watchProject(projectId: string, repoPath: string): Promise<void> {
    if (this.watchers.has(projectId)) {
      return;
    }

    const watcher = chokidar.watch(repoPath, {
      ignored: (watchedPath) => IGNORED_DIRECTORIES.test(watchedPath),
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50
      }
    });

    const state = await this.git.safeGetRepoState(repoPath);
    const schedule = () => {
      const existing = this.timers.get(projectId);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(async () => {
        const previous = this.watchers.get(projectId)?.state ?? null;
        const next = await this.git.safeGetRepoState(repoPath);
        const entry = this.watchers.get(projectId);
        if (!entry) {
          return;
        }

        entry.state = next;
        const payload: RepoStateEvent = {
          projectId,
          branchName: next?.currentBranch ?? null,
          headSha: next?.headSha ?? null,
          dirty: next?.dirty ?? false
        };

        this.dispatchEvent("repo.changed", payload);
        if ((previous?.currentBranch ?? null) !== payload.branchName || (previous?.headSha ?? null) !== payload.headSha) {
          this.dispatchEvent("repo.branchChanged", payload);
        }
        if ((previous?.dirty ?? false) !== payload.dirty) {
          this.dispatchEvent("repo.dirtyStateChanged", payload);
        }
      }, 350);

      this.timers.set(projectId, timer);
    };

    watcher.on("all", schedule);

    this.watchers.set(projectId, { watcher, state });
  }

  async unwatchProject(projectId: string): Promise<void> {
    const timer = this.timers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(projectId);
    }

    const entry = this.watchers.get(projectId);
    if (!entry) {
      return;
    }

    this.watchers.delete(projectId);
    await entry.watcher.close();
  }

  async primeExisting(projects: Array<{ id: string; repoPath: string }>): Promise<void> {
    for (const project of projects) {
      await this.watchProject(project.id, path.normalize(project.repoPath));
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((projectId) => this.unwatchProject(projectId)));
  }
}
