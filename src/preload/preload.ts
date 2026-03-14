import { contextBridge, ipcRenderer } from "electron";
import type { CodeWatchApi, GitWorkflowEvent, RepoStateEvent, ReviewSessionEvent } from "@shared/types";

function bindEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api: CodeWatchApi = {
  projects: {
    pickDirectory: () => ipcRenderer.invoke("projects:pickDirectory"),
    add: (repoPath) => ipcRenderer.invoke("projects:add", repoPath),
    list: () => ipcRenderer.invoke("projects:list"),
    reorder: (projectIds) => ipcRenderer.invoke("projects:reorder", projectIds),
    remove: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
    togglePin: (projectId) => ipcRenderer.invoke("projects:togglePin", projectId),
    listBranches: (projectId) => ipcRenderer.invoke("projects:listBranches", projectId),
    updateBaseBranch: (projectId, baseBranch) => ipcRenderer.invoke("projects:updateBaseBranch", projectId, baseBranch)
  },
  reviews: {
    open: (projectId, baseBranch) => ipcRenderer.invoke("reviews:open", projectId, baseBranch),
    list: (projectId) => ipcRenderer.invoke("reviews:list", projectId),
    load: (sessionId) => ipcRenderer.invoke("reviews:load", sessionId),
    files: (sessionId) => ipcRenderer.invoke("reviews:files", sessionId),
    diff: (sessionId, filePath, source) => ipcRenderer.invoke("reviews:diff", sessionId, filePath, source)
  },
  threads: {
    listForFile: (sessionId, filePath) => ipcRenderer.invoke("threads:listForFile", sessionId, filePath),
    get: (threadId, cursor) => ipcRenderer.invoke("threads:get", threadId, cursor),
    create: (anchor, body) => ipcRenderer.invoke("threads:create", anchor, body),
    addComment: (threadId, body) => ipcRenderer.invoke("threads:addComment", threadId, body),
    resolve: (threadId) => ipcRenderer.invoke("threads:resolve", threadId),
    reopen: (threadId) => ipcRenderer.invoke("threads:reopen", threadId)
  },
  search: {
    files: (query, limit) => ipcRenderer.invoke("search:files", query, limit)
  },
  settings: {
    loadKeybindings: () => ipcRenderer.invoke("settings:loadKeybindings"),
    openKeybindingsInEditor: () => ipcRenderer.invoke("settings:openKeybindingsInEditor"),
    reset: () => ipcRenderer.invoke("settings:reset"),
    loadAssistantSettings: () => ipcRenderer.invoke("settings:loadAssistantSettings"),
    saveAssistantProvider: (provider) => ipcRenderer.invoke("settings:saveAssistantProvider", provider)
  },
  assistants: {
    codexStatus: () => ipcRenderer.invoke("assistants:codexStatus"),
    opencodeStatus: () => ipcRenderer.invoke("assistants:opencodeStatus"),
    draftGitArtifacts: (sessionId, action) => ipcRenderer.invoke("assistants:draftGitArtifacts", sessionId, action),
    draftGitArtifactsWithProvider: (sessionId, provider, action) =>
      ipcRenderer.invoke("assistants:draftGitArtifactsWithProvider", sessionId, provider, action),
    runGitAction: (sessionId, action) => ipcRenderer.invoke("assistants:runGitAction", sessionId, action),
    runGitActionWithProvider: (sessionId, provider, action) =>
      ipcRenderer.invoke("assistants:runGitActionWithProvider", sessionId, provider, action)
  },
  events: {
    onRepoChanged: (listener: (payload: RepoStateEvent) => void) => bindEvent("repo.changed", listener),
    onBranchChanged: (listener: (payload: RepoStateEvent) => void) => bindEvent("repo.branchChanged", listener),
    onDirtyStateChanged: (listener: (payload: RepoStateEvent) => void) => bindEvent("repo.dirtyStateChanged", listener),
    onReviewSessionCreated: (listener: (payload: ReviewSessionEvent) => void) =>
      bindEvent("review.sessionCreated", listener),
    onGitWorkflowProgress: (listener: (payload: GitWorkflowEvent) => void) =>
      bindEvent("git.workflowProgress", listener)
  }
};

contextBridge.exposeInMainWorld("codeWatch", api);

declare global {
  interface Window {
    codeWatch: CodeWatchApi;
  }
}
