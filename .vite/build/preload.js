"use strict";
const electron = require("electron");
function bindEvent(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  electron.ipcRenderer.on(channel, wrapped);
  return () => electron.ipcRenderer.off(channel, wrapped);
}
const api = {
  projects: {
    pickDirectory: () => electron.ipcRenderer.invoke("projects:pickDirectory"),
    add: (repoPath) => electron.ipcRenderer.invoke("projects:add", repoPath),
    list: () => electron.ipcRenderer.invoke("projects:list"),
    remove: (projectId) => electron.ipcRenderer.invoke("projects:remove", projectId),
    updateBaseBranch: (projectId, baseBranch) => electron.ipcRenderer.invoke("projects:updateBaseBranch", projectId, baseBranch)
  },
  reviews: {
    open: (projectId, baseBranch) => electron.ipcRenderer.invoke("reviews:open", projectId, baseBranch),
    list: (projectId) => electron.ipcRenderer.invoke("reviews:list", projectId),
    load: (sessionId) => electron.ipcRenderer.invoke("reviews:load", sessionId),
    files: (sessionId) => electron.ipcRenderer.invoke("reviews:files", sessionId),
    diff: (sessionId, filePath, cursor) => electron.ipcRenderer.invoke("reviews:diff", sessionId, filePath, cursor)
  },
  threads: {
    listForFile: (sessionId, filePath) => electron.ipcRenderer.invoke("threads:listForFile", sessionId, filePath),
    get: (threadId, cursor) => electron.ipcRenderer.invoke("threads:get", threadId, cursor),
    create: (anchor, body) => electron.ipcRenderer.invoke("threads:create", anchor, body),
    addComment: (threadId, body) => electron.ipcRenderer.invoke("threads:addComment", threadId, body),
    resolve: (threadId) => electron.ipcRenderer.invoke("threads:resolve", threadId),
    reopen: (threadId) => electron.ipcRenderer.invoke("threads:reopen", threadId)
  },
  events: {
    onRepoChanged: (listener) => bindEvent("repo.changed", listener),
    onBranchChanged: (listener) => bindEvent("repo.branchChanged", listener),
    onDirtyStateChanged: (listener) => bindEvent("repo.dirtyStateChanged", listener),
    onReviewSessionCreated: (listener) => bindEvent("review.sessionCreated", listener)
  }
};
electron.contextBridge.exposeInMainWorld("codeWatch", api);
//# sourceMappingURL=preload.js.map
