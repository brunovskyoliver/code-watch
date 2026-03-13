import { useDeferredValue, useEffect } from "react";
import { DiffViewer } from "@renderer/components/diff-viewer";
import { EmptyState, LoadingState } from "@renderer/components/shared";
import { Sidebar } from "@renderer/components/sidebar";
import { FileList } from "@renderer/components/file-list";
import { ThreadPanel } from "@renderer/components/thread-panel";
import { useAppStore } from "@renderer/store/app-store";

export default function App() {
  const {
    projects,
    sessionsByProject,
    activeProjectId,
    activeSession,
    liveSessionId,
    reviewMode,
    projectIssue,
    files,
    selectedFilePath,
    diffsByFile,
    threadPreviewsByFile,
    activeThread,
    activeThreadPreview,
    composerAnchor,
    initializing,
    loadingReview,
    loadingDiff,
    loadingThread,
    error,
    initialize,
    addProject,
    removeProject,
    selectProject,
    refreshProject,
    selectSession,
    returnToLiveSession,
    selectFile,
    loadMoreDiff,
    updateBaseBranch,
    beginThread,
    selectThread,
    loadOlderComments,
    createThread,
    addComment,
    resolveThread,
    reopenThread,
    dismissComposer,
    clearError
  } = useAppStore();

  useEffect(() => {
    void initialize();

    const offRepoChanged = window.codeWatch.events.onRepoChanged((payload) => {
      void refreshProject(payload.projectId);
    });
    const offBranchChanged = window.codeWatch.events.onBranchChanged((payload) => {
      void refreshProject(payload.projectId);
    });
    const offDirtyChanged = window.codeWatch.events.onDirtyStateChanged((payload) => {
      void refreshProject(payload.projectId);
    });

    return () => {
      offRepoChanged();
      offBranchChanged();
      offDirtyChanged();
    };
  }, [initialize, refreshProject]);

  const deferredFilePath = useDeferredValue(selectedFilePath);
  const activeDiff = deferredFilePath ? diffsByFile[deferredFilePath] ?? null : null;
  const activeThreadPreviews = selectedFilePath ? threadPreviewsByFile[selectedFilePath] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const showPinnedBanner =
    reviewMode === "pinned" && Boolean(liveSessionId) && Boolean(activeSession) && activeSession?.session.id !== liveSessionId;

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        sessionsByProject={sessionsByProject}
        activeProjectId={activeProjectId}
        activeSessionId={activeSession?.session.id ?? null}
        onAddProject={() => void addProject()}
        onRemoveProject={(projectId) => void removeProject(projectId)}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onSelectSession={(projectId, sessionId) => void selectSession(projectId, sessionId)}
      />

      <main className="main-pane">
        <header className="topbar">
          <div>
            <p className="eyebrow">Review session</p>
            <h2>{activeSession ? activeSession.project.name : "Select a project"}</h2>
          </div>
          {activeSession && activeProject ? (
            <div className="topbar-meta">
              <span className="badge">Current: {activeSession.project.currentBranch ?? "detached"}</span>
              <label className="base-branch-control">
                <span>Base branch</span>
                <input
                  key={`${activeProject.id}:${activeProject.defaultBaseBranch}`}
                  defaultValue={activeProject.defaultBaseBranch}
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value && value !== activeProject.defaultBaseBranch) {
                      void updateBaseBranch(activeProject.id, value);
                    }
                  }}
                />
              </label>
              {activeSession.dirty ? <span className="badge badge-warning">Working tree dirty</span> : null}
            </div>
          ) : null}
        </header>

        {showPinnedBanner && activeProject ? (
          <div className="mode-banner">
            <div>
              <strong>Viewing saved history</strong>
              <p>
                Current repo state is {activeProject.currentBranch ?? "detached"} at{" "}
                {activeProject.headSha ? activeProject.headSha.slice(0, 7) : "unknown"}.
              </p>
            </div>
            <button className="primary-button" onClick={() => void returnToLiveSession()}>
              Return to current review
            </button>
          </div>
        ) : null}

        {projectIssue ? (
          <div className="mode-banner mode-banner-warning">
            <div>
              <strong>Project unavailable</strong>
              <p>{projectIssue}</p>
            </div>
          </div>
        ) : null}

        {initializing ? (
          <LoadingState label="Loading projects" />
        ) : activeSession ? (
          <div className="review-layout">
            <section className="file-pane">
              <div className="pane-header">
                <h3>Changed Files</h3>
                <span>{files.length}</span>
              </div>
              {loadingReview ? (
                <LoadingState label="Refreshing review" />
              ) : (
                <FileList files={files} selectedFilePath={selectedFilePath} onSelect={selectFile} />
              )}
            </section>

            <section className="diff-pane">
              <div className="pane-header">
                <h3>{selectedFilePath ?? "Diff"}</h3>
                {loadingDiff ? <span className="loading-pill">Loading diff…</span> : null}
              </div>
              {activeDiff ? (
                <DiffViewer
                  sessionId={activeSession.session.id}
                  diff={activeDiff}
                  threadPreviews={activeThreadPreviews}
                  onCreateThread={beginThread}
                  onSelectThread={(threadId) => void selectThread(threadId)}
                  onLoadMore={() => void loadMoreDiff()}
                />
              ) : selectedFilePath ? (
                <LoadingState label="Loading file diff" />
              ) : (
                <EmptyState title="No changed files" body="This review session does not have committed changes to display." />
              )}
            </section>

            <section className="thread-pane">
              <ThreadPanel
                filePath={selectedFilePath}
                threadPreviews={activeThreadPreviews}
                activeThread={activeThread}
                activeThreadPreview={activeThreadPreview}
                composerAnchor={composerAnchor}
                loadingThread={loadingThread}
                onSelectThread={(threadId) => void selectThread(threadId)}
                onLoadOlder={() => void loadOlderComments()}
                onCreateThread={(body) => void createThread(body)}
                onAddComment={(body) => void addComment(body)}
                onResolve={() => void resolveThread()}
                onReopen={() => void reopenThread()}
                onCancelComposer={dismissComposer}
              />
            </section>
          </div>
        ) : (
          <EmptyState
            title="Add a repository"
            body="Start by adding a local Git repository. Code Watch will open the current branch against its saved base branch."
            actionLabel="Add repository"
            onAction={() => void addProject()}
          />
        )}
      </main>

      {error ? (
        <div className="toast">
          <span>{error}</span>
          <button onClick={clearError}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
}
