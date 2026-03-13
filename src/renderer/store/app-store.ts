import { create } from "zustand";
import type {
  ChangedFile,
  PaginatedComments,
  PaginatedFileDiff,
  ProjectSummary,
  ReviewOpenResult,
  ReviewSessionDetail,
  ReviewSessionSummary,
  ThreadAnchor,
  ThreadPreview
} from "@shared/types";

type ReviewMode = "live" | "pinned";

interface AppState {
  projects: ProjectSummary[];
  sessionsByProject: Record<string, ReviewSessionSummary[]>;
  activeProjectId: string | null;
  activeSession: ReviewSessionDetail | null;
  liveSessionId: string | null;
  reviewMode: ReviewMode;
  projectIssue: string | null;
  files: ChangedFile[];
  selectedFilePath: string | null;
  diffsByFile: Record<string, PaginatedFileDiff>;
  threadPreviewsByFile: Record<string, ThreadPreview[]>;
  activeThread: PaginatedComments | null;
  activeThreadPreview: ThreadPreview | null;
  composerAnchor: ThreadAnchor | null;
  initializing: boolean;
  loadingReview: boolean;
  loadingDiff: boolean;
  loadingThread: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  selectSession: (projectId: string, sessionId: string) => Promise<void>;
  returnToLiveSession: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  loadMoreDiff: () => Promise<void>;
  updateBaseBranch: (projectId: string, baseBranch: string) => Promise<void>;
  beginThread: (anchor: ThreadAnchor) => void;
  selectThread: (threadId: string) => Promise<void>;
  loadOlderComments: () => Promise<void>;
  createThread: (body: string) => Promise<void>;
  addComment: (body: string) => Promise<void>;
  resolveThread: () => Promise<void>;
  reopenThread: () => Promise<void>;
  dismissComposer: () => void;
  clearError: () => void;
}

interface ReviewSnapshot {
  detail: ReviewSessionDetail;
  files: ChangedFile[];
}

const baseState = {
  projects: [] as ProjectSummary[],
  sessionsByProject: {} as Record<string, ReviewSessionSummary[]>,
  activeProjectId: null as string | null,
  activeSession: null as ReviewSessionDetail | null,
  liveSessionId: null as string | null,
  reviewMode: "live" as ReviewMode,
  projectIssue: null as string | null,
  files: [] as ChangedFile[],
  selectedFilePath: null as string | null,
  diffsByFile: {} as Record<string, PaginatedFileDiff>,
  threadPreviewsByFile: {} as Record<string, ThreadPreview[]>,
  activeThread: null as PaginatedComments | null,
  activeThreadPreview: null as ThreadPreview | null,
  composerAnchor: null as ThreadAnchor | null,
  initializing: true,
  loadingReview: false,
  loadingDiff: false,
  loadingThread: false,
  error: null as string | null
};

export function resetAppStore(): void {
  useAppStore.setState(baseState);
}

export const useAppStore = create<AppState>((set, get) => ({
  ...baseState,
  initialize: async () => {
    set({ initializing: true, error: null, projectIssue: null });
    try {
      const projects = await window.codeWatch.projects.list();
      set({
        projects,
        initializing: false,
        activeProjectId: projects[0]?.id ?? null
      });

      if (projects[0]) {
        await get().selectProject(projects[0].id);
      }
    } catch (error) {
      set({ initializing: false, error: toErrorMessage(error) });
    }
  },
  addProject: async () => {
    try {
      const repoPath = await window.codeWatch.projects.pickDirectory();
      if (!repoPath) {
        return;
      }

      const project = await window.codeWatch.projects.add(repoPath);
      set((state) => ({
        projects: [project, ...state.projects.filter((entry) => entry.id !== project.id)],
        activeProjectId: project.id,
        error: null,
        projectIssue: null
      }));
      await get().selectProject(project.id);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  removeProject: async (projectId) => {
    try {
      await window.codeWatch.projects.remove(projectId);
      set((state) => {
        const projects = state.projects.filter((project) => project.id !== projectId);
        const removingActive = state.activeProjectId === projectId;
        return {
          projects,
          activeProjectId: removingActive ? (projects[0]?.id ?? null) : state.activeProjectId,
          activeSession: removingActive ? null : state.activeSession,
          liveSessionId: removingActive ? null : state.liveSessionId,
          files: removingActive ? [] : state.files,
          selectedFilePath: removingActive ? null : state.selectedFilePath,
          diffsByFile: removingActive ? {} : state.diffsByFile,
          threadPreviewsByFile: removingActive ? {} : state.threadPreviewsByFile,
          activeThread: removingActive ? null : state.activeThread,
          activeThreadPreview: removingActive ? null : state.activeThreadPreview,
          composerAnchor: removingActive ? null : state.composerAnchor,
          projectIssue: removingActive ? null : state.projectIssue,
          sessionsByProject: Object.fromEntries(
            Object.entries(state.sessionsByProject).filter(([entryProjectId]) => entryProjectId !== projectId)
          )
        };
      });

      const nextProjectId = get().activeProjectId;
      if (nextProjectId) {
        await get().selectProject(nextProjectId);
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  selectProject: async (projectId) => {
    set({
      activeProjectId: projectId,
      reviewMode: "live",
      loadingReview: true,
      loadingDiff: false,
      loadingThread: false,
      error: null,
      projectIssue: null,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    });

    await syncProject(projectId, set, get, true);
  },
  refreshProject: async (projectId) => {
    await syncProject(projectId, set, get, false);
  },
  selectSession: async (projectId, sessionId) => {
    set({
      activeProjectId: projectId,
      reviewMode: "pinned",
      loadingReview: true,
      error: null,
      projectIssue: null,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    });

    try {
      const [detail, sessions, projects] = await Promise.all([
        window.codeWatch.reviews.load(sessionId),
        window.codeWatch.reviews.list(projectId),
        window.codeWatch.projects.list()
      ]);

      const files = await window.codeWatch.reviews.files(sessionId);
      const selectedFilePath = pickPreferredFile(get().selectedFilePath, files);

      set((state) => ({
        projects,
        loadingReview: false,
        activeSession: detail,
        files,
        selectedFilePath,
        sessionsByProject: {
          ...state.sessionsByProject,
          [projectId]: sessions
        },
        diffsByFile: {},
        threadPreviewsByFile: {},
        activeThread: null,
        activeThreadPreview: null,
        composerAnchor: null
      }));

      if (selectedFilePath) {
        await get().selectFile(selectedFilePath);
      }
    } catch (error) {
      set({ loadingReview: false, error: toErrorMessage(error) });
    }
  },
  returnToLiveSession: async () => {
    const projectId = get().activeProjectId;
    if (!projectId) {
      return;
    }

    set({ reviewMode: "live", projectIssue: null });
    await syncProject(projectId, set, get, true);
  },
  selectFile: async (filePath) => {
    const sessionId = get().activeSession?.session.id;
    if (!sessionId) {
      return;
    }

    const existingDiff = get().diffsByFile[filePath];
    const existingThreads = get().threadPreviewsByFile[filePath];

    set({
      selectedFilePath: filePath,
      loadingDiff: !existingDiff,
      loadingThread: !existingThreads,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    });

    try {
      const diffPromise = existingDiff ? Promise.resolve(existingDiff) : window.codeWatch.reviews.diff(sessionId, filePath);
      const threadsPromise = existingThreads
        ? Promise.resolve(existingThreads)
        : window.codeWatch.threads.listForFile(sessionId, filePath);

      const [diff, threadPreviews] = await Promise.all([diffPromise, threadsPromise]);

      if (get().selectedFilePath !== filePath || get().activeSession?.session.id !== sessionId) {
        return;
      }

      set((state) => ({
        loadingDiff: false,
        loadingThread: false,
        diffsByFile: {
          ...state.diffsByFile,
          [filePath]: diff
        },
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [filePath]: threadPreviews
        }
      }));
    } catch (error) {
      set({ loadingDiff: false, loadingThread: false, error: toErrorMessage(error) });
    }
  },
  loadMoreDiff: async () => {
    const sessionId = get().activeSession?.session.id;
    const filePath = get().selectedFilePath;
    if (!sessionId || !filePath) {
      return;
    }

    const diff = get().diffsByFile[filePath];
    if (!diff?.hasMore || !diff.nextCursor || get().loadingDiff) {
      return;
    }

    set({ loadingDiff: true });
    try {
      const nextPage = await window.codeWatch.reviews.diff(sessionId, filePath, diff.nextCursor);

      if (get().selectedFilePath !== filePath || get().activeSession?.session.id !== sessionId) {
        return;
      }

      set((state) => ({
        loadingDiff: false,
        diffsByFile: {
          ...state.diffsByFile,
          [filePath]: {
            ...nextPage,
            rows: [...diff.rows, ...nextPage.rows]
          }
        }
      }));
    } catch (error) {
      set({ loadingDiff: false, error: toErrorMessage(error) });
    }
  },
  updateBaseBranch: async (projectId, baseBranch) => {
    try {
      const project = await window.codeWatch.projects.updateBaseBranch(projectId, baseBranch);
      set((state) => ({
        projects: state.projects.map((entry) => (entry.id === project.id ? project : entry)),
        projectIssue: null
      }));
      await get().returnToLiveSession();
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  beginThread: (anchor) => {
    set({
      composerAnchor: anchor,
      activeThread: null,
      activeThreadPreview: null
    });
  },
  selectThread: async (threadId) => {
    set({ loadingThread: true, composerAnchor: null, error: null });
    try {
      const filePath = get().selectedFilePath;
      const preview = filePath ? get().threadPreviewsByFile[filePath]?.find((thread) => thread.id === threadId) ?? null : null;
      const activeThread = await window.codeWatch.threads.get(threadId);
      set({ activeThread, activeThreadPreview: preview, loadingThread: false });
    } catch (error) {
      set({ loadingThread: false, error: toErrorMessage(error) });
    }
  },
  loadOlderComments: async () => {
    const activeThread = get().activeThread;
    if (!activeThread?.nextCursor) {
      return;
    }

    try {
      const older = await window.codeWatch.threads.get(activeThread.threadId, activeThread.nextCursor);
      set((state) => ({
        activeThread: state.activeThread
          ? {
              threadId: state.activeThread.threadId,
              comments: [...older.comments, ...state.activeThread.comments],
              hasMore: older.hasMore,
              nextCursor: older.nextCursor
            }
          : null
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  createThread: async (body) => {
    const anchor = get().composerAnchor;
    const sessionId = get().activeSession?.session.id;
    if (!anchor || !sessionId) {
      return;
    }

    try {
      const preview = await window.codeWatch.threads.create(anchor, body);
      const [activeThread, previews] = await Promise.all([
        window.codeWatch.threads.get(preview.id),
        window.codeWatch.threads.listForFile(sessionId, anchor.filePath)
      ]);

      set((state) => ({
        composerAnchor: null,
        activeThread,
        activeThreadPreview: preview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [anchor.filePath]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  addComment: async (body) => {
    const threadId = get().activeThread?.threadId;
    const filePath = get().selectedFilePath;
    const sessionId = get().activeSession?.session.id;
    if (!threadId || !filePath || !sessionId) {
      return;
    }

    try {
      const [activeThread, previews] = await Promise.all([
        window.codeWatch.threads.addComment(threadId, body),
        window.codeWatch.threads.listForFile(sessionId, filePath)
      ]);

      const activeThreadPreview = previews.find((thread) => thread.id === threadId) ?? null;
      set((state) => ({
        activeThread,
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [filePath]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  resolveThread: async () => {
    const threadId = get().activeThread?.threadId;
    const filePath = get().selectedFilePath;
    const sessionId = get().activeSession?.session.id;
    if (!threadId || !filePath || !sessionId) {
      return;
    }

    try {
      const [activeThreadPreview, previews] = await Promise.all([
        window.codeWatch.threads.resolve(threadId),
        window.codeWatch.threads.listForFile(sessionId, filePath)
      ]);
      set((state) => ({
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [filePath]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  reopenThread: async () => {
    const threadId = get().activeThread?.threadId;
    const filePath = get().selectedFilePath;
    const sessionId = get().activeSession?.session.id;
    if (!threadId || !filePath || !sessionId) {
      return;
    }

    try {
      const [activeThreadPreview, previews] = await Promise.all([
        window.codeWatch.threads.reopen(threadId),
        window.codeWatch.threads.listForFile(sessionId, filePath)
      ]);
      set((state) => ({
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [filePath]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  dismissComposer: () => set({ composerAnchor: null }),
  clearError: () => set({ error: null })
}));

async function syncProject(
  projectId: string,
  set: (updater: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  forceHydrateActive: boolean
): Promise<void> {
  const state = get();
  const isActive = state.activeProjectId === projectId;

  try {
    const [projects, openResult, sessions] = await Promise.all([
      window.codeWatch.projects.list(),
      window.codeWatch.reviews.open(projectId),
      window.codeWatch.reviews.list(projectId)
    ]);

    set((currentState) => ({
      projects,
      liveSessionId: isActive ? openResult.detail.session.id : currentState.liveSessionId,
      projectIssue: isActive ? null : currentState.projectIssue,
      sessionsByProject: {
        ...currentState.sessionsByProject,
        [projectId]: sessions
      }
    }));

    if (!isActive) {
      return;
    }

    const shouldHydrate = forceHydrateActive || get().reviewMode === "live";
    if (shouldHydrate) {
      await hydrateReview(openResult, sessions, set, get);
      return;
    }

    set({
      loadingReview: false,
      liveSessionId: openResult.detail.session.id,
      projectIssue: null
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (isActive) {
      set({
        loadingReview: false,
        loadingDiff: false,
        loadingThread: false,
        projectIssue: message,
        error: message
      });
    } else {
      set({ error: message });
    }
  }
}

async function hydrateReview(
  openResult: ReviewOpenResult,
  sessions: ReviewSessionSummary[],
  set: (updater: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState
): Promise<void> {
  const snapshot = await loadReviewSnapshot(openResult.detail);
  const selectedFilePath = pickPreferredFile(get().selectedFilePath, snapshot.files);

  set((state) => ({
    loadingReview: false,
    projectIssue: null,
    activeSession: snapshot.detail,
    liveSessionId: snapshot.detail.session.id,
    files: snapshot.files,
    selectedFilePath,
    sessionsByProject: {
      ...state.sessionsByProject,
      [snapshot.detail.project.id]: sessions
    },
    diffsByFile: {},
    threadPreviewsByFile: {},
    activeThread: null,
    activeThreadPreview: null,
    composerAnchor: null
  }));

  if (selectedFilePath) {
    await get().selectFile(selectedFilePath);
  }
}

async function loadReviewSnapshot(detail: ReviewSessionDetail): Promise<ReviewSnapshot> {
  const files = await window.codeWatch.reviews.files(detail.session.id);
  return { detail, files };
}

function pickPreferredFile(previousFilePath: string | null, files: ChangedFile[]): string | null {
  if (previousFilePath && files.some((file) => file.filePath === previousFilePath)) {
    return previousFilePath;
  }

  return files[0]?.filePath ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
