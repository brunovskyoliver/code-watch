import { create } from "zustand";
import type {
  ChangedFile,
  FileSearchResult,
  FileDiff,
  PaginatedComments,
  ProjectSummary,
  ReviewOpenResult,
  ReviewSessionDetail,
  ReviewSessionSummary,
  ThreadAnchor,
  ThreadPreview
} from "@shared/types";

interface AppState {
  projects: ProjectSummary[];
  baseBranchesByProject: Record<string, string[]>;
  sessionsByProject: Record<string, ReviewSessionSummary[]>;
  activeProjectId: string | null;
  activeSession: ReviewSessionDetail | null;
  files: ChangedFile[];
  selectedFileId: string | null;
  openFiles: string[];
  diffsByFile: Record<string, FileDiff>;
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
  reorderProjects: (projectIds: string[]) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  togglePinProject: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  selectSession: (projectId: string, sessionId: string) => Promise<void>;
  selectFile: (fileId: string) => Promise<void>;
  closeFile: (fileId: string) => Promise<void>;
  reorderOpenFiles: (openFiles: string[]) => void;
  listBranches: (projectId: string) => Promise<string[]>;
  updateBaseBranch: (projectId: string, baseBranch: string) => Promise<void>;
  searchFiles: (query: string, limit?: number) => Promise<FileSearchResult[]>;
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

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  baseBranchesByProject: {},
  sessionsByProject: {},
  activeProjectId: null,
  activeSession: null,
  files: [],
  selectedFileId: null,
  openFiles: [],
  diffsByFile: {},
  threadPreviewsByFile: {},
  activeThread: null,
  activeThreadPreview: null,
  composerAnchor: null,
  initializing: true,
  loadingReview: false,
  loadingDiff: false,
  loadingThread: false,
  error: null,
  initialize: async () => {
    set({ initializing: true, error: null });
    try {
      const projects = await window.codeWatch.projects.list();
      set({ projects, initializing: false, activeProjectId: projects[0]?.id ?? null });
      if (projects[0]) {
        await get().selectProject(projects[0].id);
      }
    } catch (error) {
      set({ initializing: false, error: toErrorMessage(error) });
    }
  },
  addProject: async () => {
    try {
      const path = await window.codeWatch.projects.pickDirectory();
      if (!path) {
        return;
      }
      const project = await window.codeWatch.projects.add(path);
      set((state) => ({
        projects: [...state.projects.filter((entry) => entry.id !== project.id), project],
        activeProjectId: project.id,
        error: null
      }));
      await get().selectProject(project.id);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  reorderProjects: async (projectIds) => {
    try {
      const projects = await window.codeWatch.projects.reorder(projectIds);
      set({ projects, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  removeProject: async (projectId) => {
    try {
      await window.codeWatch.projects.remove(projectId);
      set((state) => {
        const projects = state.projects.filter((project) => project.id !== projectId);
        const nextProjectId = state.activeProjectId === projectId ? (projects[0]?.id ?? null) : state.activeProjectId;
        return {
          projects,
          activeProjectId: nextProjectId,
          activeSession: state.activeProjectId === projectId ? null : state.activeSession,
          files: state.activeProjectId === projectId ? [] : state.files,
          selectedFileId: state.activeProjectId === projectId ? null : state.selectedFileId,
          openFiles: state.activeProjectId === projectId ? [] : state.openFiles,
          diffsByFile: state.activeProjectId === projectId ? {} : state.diffsByFile,
          threadPreviewsByFile: state.activeProjectId === projectId ? {} : state.threadPreviewsByFile,
          activeThread: state.activeProjectId === projectId ? null : state.activeThread,
          activeThreadPreview: state.activeProjectId === projectId ? null : state.activeThreadPreview,
          composerAnchor: state.activeProjectId === projectId ? null : state.composerAnchor,
          sessionsByProject: Object.fromEntries(
            Object.entries(state.sessionsByProject).filter(([entryProjectId]) => entryProjectId !== projectId)
          ),
          baseBranchesByProject: Object.fromEntries(
            Object.entries(state.baseBranchesByProject).filter(([entryProjectId]) => entryProjectId !== projectId)
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
  togglePinProject: async (projectId) => {
    try {
      const updatedProject = await window.codeWatch.projects.togglePin(projectId);
      set((state) => ({
        projects: state.projects.map((project) => (project.id === projectId ? updatedProject : project))
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  selectProject: async (projectId) => {
    set({
      activeProjectId: projectId,
      loadingReview: true,
      error: null,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    });

    try {
      const [openResult, sessions] = await Promise.all([
        window.codeWatch.reviews.open(projectId),
        window.codeWatch.reviews.list(projectId)
      ]);

      await hydrateReview(openResult, sessions, set, get);
    } catch (error) {
      set({ loadingReview: false, error: toErrorMessage(error) });
    }
  },
  refreshProject: async (projectId) => {
    if (get().activeProjectId !== projectId) {
      return;
    }

    try {
      const [openResult, sessions] = await Promise.all([
        window.codeWatch.reviews.open(projectId),
        window.codeWatch.reviews.list(projectId)
      ]);
      await hydrateReview(openResult, sessions, set, get);
    } catch (error) {
      set({ error: toErrorMessage(error), loadingReview: false });
    }
  },
  selectSession: async (projectId, sessionId) => {
    const preferredFileId = get().selectedFileId;
    set({
      activeProjectId: projectId,
      loadingReview: true,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null,
      error: null
    });

    try {
      const [detail, sessions, files] = await Promise.all([
        window.codeWatch.reviews.load(sessionId),
        window.codeWatch.reviews.list(projectId),
        window.codeWatch.reviews.files(sessionId)
      ]);

      const selectedFileId = resolveSelectedFileId(files, preferredFileId);
      set((state) => {
        const isSameSession = state.activeSession?.session.id === sessionId;
        const validFileIds = new Set(files.map((file) => file.id));
        let nextOpenFiles = isSameSession ? state.openFiles.filter((fileId) => validFileIds.has(fileId)) : [];
        if (selectedFileId && !nextOpenFiles.includes(selectedFileId)) {
          nextOpenFiles.push(selectedFileId);
        }

        return {
          loadingReview: false,
          activeSession: detail,
          files,
          selectedFileId,
          openFiles: nextOpenFiles,
          sessionsByProject: {
            ...state.sessionsByProject,
            [projectId]: sessions
          },
          diffsByFile: {},
          threadPreviewsByFile: {},
          activeThread: null,
          activeThreadPreview: null
        };
      });

      if (selectedFileId) {
        await get().selectFile(selectedFileId);
      }
    } catch (error) {
      set({ loadingReview: false, error: toErrorMessage(error) });
    }
  },
  selectFile: async (fileId) => {
    const sessionId = get().activeSession?.session.id;
    const file = get().files.find((entry) => entry.id === fileId);
    if (!sessionId || !file) {
      return;
    }

    set((state) => ({
      selectedFileId: fileId,
      openFiles: state.openFiles.includes(fileId) ? state.openFiles : [...state.openFiles, fileId],
      loadingDiff: true,
      loadingThread: true,
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    }));

    try {
      const [diff, threadPreviews] = await Promise.all([
        window.codeWatch.reviews.diff(sessionId, file.filePath, file.source),
        file.source === "committed" ? window.codeWatch.threads.listForFile(sessionId, file.filePath) : Promise.resolve([])
      ]);

      set((state) => ({
        loadingDiff: false,
        loadingThread: false,
        diffsByFile: {
          ...state.diffsByFile,
          [fileId]: diff
        },
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [fileId]: threadPreviews
        }
      }));
    } catch (error) {
      set({ loadingDiff: false, loadingThread: false, error: toErrorMessage(error) });
    }
  },
  reorderOpenFiles: (openFiles) => {
    set({ openFiles });
  },
  closeFile: async (fileId) => {
    const state = get();
    const nextOpenFiles = state.openFiles.filter((openFileId) => openFileId !== fileId);
    let nextSelectedFileId = state.selectedFileId;
    if (nextSelectedFileId === fileId) {
      const index = state.openFiles.indexOf(fileId);
      if (index > 0) {
        nextSelectedFileId = state.openFiles[index - 1] ?? null;
      } else if (nextOpenFiles.length > 0) {
        nextSelectedFileId = nextOpenFiles[0] ?? null;
      } else {
        nextSelectedFileId = null;
      }
    }
    set({ openFiles: nextOpenFiles });
    if (nextSelectedFileId && nextSelectedFileId !== state.selectedFileId) {
      void get().selectFile(nextSelectedFileId);
    } else if (!nextSelectedFileId && state.selectedFileId) {
      set({ selectedFileId: null, activeThread: null, activeThreadPreview: null, composerAnchor: null });
    }
  },
  listBranches: async (projectId) => {
    try {
      const branches = await window.codeWatch.projects.listBranches(projectId);
      set((state) => ({
        baseBranchesByProject: {
          ...state.baseBranchesByProject,
          [projectId]: branches
        }
      }));
      return branches;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return [];
    }
  },
  updateBaseBranch: async (projectId, baseBranch) => {
    try {
      const project = await window.codeWatch.projects.updateBaseBranch(projectId, baseBranch);
      set((state) => ({
        projects: state.projects.map((entry) => (entry.id === project.id ? project : entry))
      }));
      await get().refreshProject(projectId);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  searchFiles: async (query, limit) => {
    try {
      return await window.codeWatch.search.files(query, limit);
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return [];
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
      const fileId = get().selectedFileId;
      const preview = fileId ? get().threadPreviewsByFile[fileId]?.find((thread) => thread.id === threadId) ?? null : null;
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
        activeThread: {
          threadId: activeThread.threadId,
          comments: [...older.comments, ...state.activeThread!.comments],
          hasMore: older.hasMore,
          nextCursor: older.nextCursor
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  createThread: async (body) => {
    const anchor = get().composerAnchor;
    const fileId = get().selectedFileId;
    if (!anchor || !fileId) {
      return;
    }

    try {
      const preview = await window.codeWatch.threads.create(anchor, body);
      set((state) => {
        const current = state.threadPreviewsByFile[fileId] ?? [];
        return {
          composerAnchor: null,
          threadPreviewsByFile: {
            ...state.threadPreviewsByFile,
            [fileId]: [preview, ...current]
          },
          activeThreadPreview: preview
        };
      });
      const activeThread = await window.codeWatch.threads.get(preview.id);
      set({ activeThread });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  addComment: async (body) => {
    const threadId = get().activeThread?.threadId;
    const fileId = get().selectedFileId;
    const file = fileId ? get().files.find((entry) => entry.id === fileId) ?? null : null;
    if (!threadId || !fileId || !file || file.source !== "committed") {
      return;
    }

    try {
      const [activeThread, previews] = await Promise.all([
        window.codeWatch.threads.addComment(threadId, body),
        window.codeWatch.threads.listForFile(get().activeSession!.session.id, file.filePath)
      ]);

      const activeThreadPreview = previews.find((thread) => thread.id === threadId) ?? null;
      set((state) => ({
        activeThread,
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [fileId]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  resolveThread: async () => {
    const threadId = get().activeThread?.threadId;
    const fileId = get().selectedFileId;
    const file = fileId ? get().files.find((entry) => entry.id === fileId) ?? null : null;
    const sessionId = get().activeSession?.session.id;
    if (!threadId || !fileId || !file || file.source !== "committed" || !sessionId) {
      return;
    }

    try {
      const [activeThreadPreview, previews] = await Promise.all([
        window.codeWatch.threads.resolve(threadId),
        window.codeWatch.threads.listForFile(sessionId, file.filePath)
      ]);
      set((state) => ({
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [fileId]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  reopenThread: async () => {
    const threadId = get().activeThread?.threadId;
    const fileId = get().selectedFileId;
    const file = fileId ? get().files.find((entry) => entry.id === fileId) ?? null : null;
    const sessionId = get().activeSession?.session.id;
    if (!threadId || !fileId || !file || file.source !== "committed" || !sessionId) {
      return;
    }

    try {
      const [activeThreadPreview, previews] = await Promise.all([
        window.codeWatch.threads.reopen(threadId),
        window.codeWatch.threads.listForFile(sessionId, file.filePath)
      ]);
      set((state) => ({
        activeThreadPreview,
        threadPreviewsByFile: {
          ...state.threadPreviewsByFile,
          [fileId]: previews
        }
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  dismissComposer: () => set({ composerAnchor: null }),
  clearError: () => set({ error: null })
}));

async function hydrateReview(
  openResult: ReviewOpenResult,
  sessions: ReviewSessionSummary[],
  set: (updater: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState
): Promise<void> {
  const sessionId = openResult.detail.session.id;
  const files = await window.codeWatch.reviews.files(sessionId);
  const selectedFileId = resolveSelectedFileId(files, get().selectedFileId);

  set((state) => {
    const isSameSession = state.activeSession?.session.id === sessionId;
    const validFileIds = new Set(files.map((file) => file.id));
    let nextOpenFiles = isSameSession ? state.openFiles.filter((fileId) => validFileIds.has(fileId)) : [];
    if (selectedFileId && !nextOpenFiles.includes(selectedFileId)) {
      nextOpenFiles.push(selectedFileId);
    }

    return {
      loadingReview: false,
      activeSession: openResult.detail,
      files,
      selectedFileId,
      openFiles: nextOpenFiles,
      sessionsByProject: {
        ...state.sessionsByProject,
        [openResult.detail.project.id]: sessions
      },
      diffsByFile: {},
      threadPreviewsByFile: {},
      activeThread: null,
      activeThreadPreview: null,
      composerAnchor: null
    };
  });

  if (selectedFileId) {
    await get().selectFile(selectedFileId);
  }
}

function resolveSelectedFileId(files: ChangedFile[], preferredFileId: string | null): string | null {
  if (preferredFileId && files.some((file) => file.id === preferredFileId)) {
    return preferredFileId;
  }

  return files[0]?.id ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
