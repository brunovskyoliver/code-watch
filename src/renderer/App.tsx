import { Fragment, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "@renderer/store/app-store";
import type { ChangedFile, DiffLine, FileDiff, PaginatedComments, ThreadAnchor, ThreadPreview } from "@shared/types";

type DiffRow =
  | { type: "hunk"; id: string; header: string }
  | { type: "line"; id: string; line: DiffLine };

export default function App() {
  const {
    projects,
    sessionsByProject,
    activeProjectId,
    activeSession,
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
    selectFile,
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
    const offSessionCreated = window.codeWatch.events.onReviewSessionCreated((payload) => {
      void refreshProject(payload.projectId);
    });

    return () => {
      offRepoChanged();
      offBranchChanged();
      offDirtyChanged();
      offSessionCreated();
    };
  }, [initialize, refreshProject]);

  const deferredFilePath = useDeferredValue(selectedFilePath);
  const activeDiff = deferredFilePath ? diffsByFile[deferredFilePath] ?? null : null;
  const activeThreadPreviews = selectedFilePath ? threadPreviewsByFile[selectedFilePath] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Code Watch</p>
            <h1>Projects</h1>
          </div>
          <button className="ghost-button" onClick={() => void addProject()}>
            Add Repo
          </button>
        </div>

        <div className="sidebar-scroll">
          {projects.length === 0 ? (
            <EmptyState
              title="No repositories yet"
              body="Add a local Git project to start reviewing your current branch."
              actionLabel="Add repository"
              onAction={() => void addProject()}
            />
          ) : (
            projects.map((project) => {
              const sessions = sessionsByProject[project.id] ?? [];
              const isActive = project.id === activeProjectId;
              return (
                <div key={project.id} className={`project-card ${isActive ? "project-card-active" : ""}`}>
                  <button
                    className="project-button"
                    onClick={() => {
                      startTransition(() => {
                        void selectProject(project.id);
                      });
                    }}
                  >
                    <div>
                      <strong>{project.name}</strong>
                      <p>{project.repoPath}</p>
                    </div>
                    <div className="project-meta">
                      <span className="badge">{project.currentBranch ?? "detached"}</span>
                      {project.dirty ? <span className="badge badge-warning">Dirty</span> : null}
                    </div>
                  </button>

                  {isActive ? (
                    <div className="project-sessions">
                      {sessions.map((session) => (
                        <button
                          key={session.id}
                          className={`session-button ${
                            activeSession?.session.id === session.id ? "session-button-active" : ""
                          }`}
                          onClick={() => {
                            startTransition(() => {
                              void selectSession(project.id, session.id);
                            });
                          }}
                        >
                          <span>{session.branchName}</span>
                          <small>{shortSha(session.headSha)}</small>
                        </button>
                      ))}
                      <button className="danger-button" onClick={() => void removeProject(project.id)}>
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </aside>

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
                  onCreateThread={(anchor) => beginThread(anchor)}
                  onSelectThread={(threadId) => void selectThread(threadId)}
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
                onSelectThread={(threadId) => selectThread(threadId)}
                onLoadOlder={() => loadOlderComments()}
                onCreateThread={(body) => createThread(body)}
                onAddComment={(body) => addComment(body)}
                onResolve={() => resolveThread()}
                onReopen={() => reopenThread()}
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

function FileList({
  files,
  selectedFilePath,
  onSelect
}: {
  files: ChangedFile[];
  selectedFilePath: string | null;
  onSelect: (filePath: string) => Promise<void>;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 10
  });

  return (
    <div ref={parentRef} className="virtual-scroll">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          if (!file) {
            return null;
          }

          return (
            <button
              key={file.id}
              className={`file-row ${selectedFilePath === file.filePath ? "file-row-active" : ""}`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => {
                startTransition(() => {
                  void onSelect(file.filePath);
                });
              }}
            >
              <div className="file-row-main">
                <strong>{file.filePath}</strong>
                <p>
                  {file.status}
                  {file.isBinary ? " · binary" : ""}
                </p>
              </div>
              <div className="file-row-meta">
                {file.additions !== null ? <span className="diff-add">+{file.additions}</span> : null}
                {file.deletions !== null ? <span className="diff-delete">-{file.deletions}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DiffViewer({
  sessionId,
  diff,
  threadPreviews,
  onCreateThread,
  onSelectThread
}: {
  sessionId: string;
  diff: FileDiff;
  threadPreviews: ThreadPreview[];
  onCreateThread: (anchor: ThreadAnchor) => void;
  onSelectThread: (threadId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => flattenDiffRows(diff), [diff]);
  const threadMap = useMemo(() => groupThreadsByLine(threadPreviews), [threadPreviews]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "hunk" ? 36 : 28),
    overscan: 16
  });

  if (diff.isBinary) {
    return (
      <div className="binary-file-card">
        <h4>Binary file</h4>
        <p>Inline preview is disabled for binary changes in v1.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="virtual-scroll diff-scroll">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) {
            return null;
          }

          if (row.type === "hunk") {
            return (
              <div
                key={row.id}
                className="diff-hunk-row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.header}
              </div>
            );
          }

          const threadKey = getThreadKey(row.line.oldLineNumber, row.line.newLineNumber);
          const threads = threadMap.get(threadKey) ?? [];
          const firstThread = threads[0];
          const anchor = toAnchor(diff.filePath, row.line);
          const canThread = row.line.oldLineNumber !== null || row.line.newLineNumber !== null;
          return (
            <button
              key={row.id}
              className={`diff-line diff-line-${row.line.kind}`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => {
                if (canThread) {
                  onCreateThread({ ...anchor, sessionId });
                }
              }}
            >
              <span className="line-number">{row.line.oldLineNumber ?? ""}</span>
              <span className="line-number">{row.line.newLineNumber ?? ""}</span>
              <code>{row.line.kind === "add" ? "+" : row.line.kind === "delete" ? "-" : " "}{row.line.text}</code>
              {firstThread ? (
                <span
                  className="thread-chip"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectThread(firstThread.id);
                  }}
                >
                  {threads.length} thread{threads.length > 1 ? "s" : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThreadPanel({
  filePath,
  threadPreviews,
  activeThread,
  activeThreadPreview,
  composerAnchor,
  loadingThread,
  onSelectThread,
  onLoadOlder,
  onCreateThread,
  onAddComment,
  onResolve,
  onReopen,
  onCancelComposer
}: {
  filePath: string | null;
  threadPreviews: ThreadPreview[];
  activeThread: PaginatedComments | null;
  activeThreadPreview: ThreadPreview | null;
  composerAnchor: ThreadAnchor | null;
  loadingThread: boolean;
  onSelectThread: (threadId: string) => Promise<void> | void;
  onLoadOlder: () => Promise<void> | void;
  onCreateThread: (body: string) => Promise<void> | void;
  onAddComment: (body: string) => Promise<void> | void;
  onResolve: () => Promise<void> | void;
  onReopen: () => Promise<void> | void;
  onCancelComposer: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: threadPreviews.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 92,
    overscan: 8
  });

  useEffect(() => {
    setDraft("");
  }, [composerAnchor?.lineContentHash, activeThread?.threadId]);

  const submit = async () => {
    const value = draft.trim();
    if (!value) {
      return;
    }

    if (composerAnchor) {
      await onCreateThread(value);
    } else {
      await onAddComment(value);
    }
    setDraft("");
  };

  return (
    <Fragment>
      <div className="pane-header">
        <h3>Threads</h3>
        <span>{threadPreviews.length}</span>
      </div>

      {!filePath ? (
        <EmptyState title="Select a file" body="Thread previews appear once a changed file is selected." />
      ) : (
        <div className="thread-layout">
          <div ref={listRef} className="virtual-scroll thread-list-scroll">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const thread = threadPreviews[virtualRow.index];
                if (!thread) {
                  return null;
                }

                const latestComment = thread.latestComments.at(-1);
                const active = activeThreadPreview?.id === thread.id;
                return (
                  <button
                    key={thread.id}
                    className={`thread-preview ${active ? "thread-preview-active" : ""}`}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                    onClick={() => void onSelectThread(thread.id)}
                  >
                    <div className="thread-preview-head">
                      <span>Line {thread.anchor.newLine ?? thread.anchor.oldLine ?? "?"}</span>
                      <span className={`status-pill status-pill-${thread.status}`}>{thread.status}</span>
                    </div>
                    <p>{latestComment?.body ?? "No comments"}</p>
                    {thread.remainingCommentCount > 0 ? (
                      <small>{thread.remainingCommentCount} older comment{thread.remainingCommentCount > 1 ? "s" : ""}</small>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="thread-detail">
            {composerAnchor ? (
              <Fragment>
                <div className="thread-detail-header">
                  <h4>New thread</h4>
                  <button className="ghost-button" onClick={onCancelComposer}>
                    Cancel
                  </button>
                </div>
                <p className="thread-meta">
                  Anchored at line {composerAnchor.newLine ?? composerAnchor.oldLine ?? "?"}
                </p>
              </Fragment>
            ) : activeThreadPreview ? (
              <Fragment>
                <div className="thread-detail-header">
                  <div>
                    <h4>Thread</h4>
                    <p className="thread-meta">
                      Line {activeThreadPreview.anchor.newLine ?? activeThreadPreview.anchor.oldLine ?? "?"}
                    </p>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => void (activeThreadPreview.status === "open" ? onResolve() : onReopen())}
                  >
                    {activeThreadPreview.status === "open" ? "Resolve" : "Reopen"}
                  </button>
                </div>
              </Fragment>
            ) : (
              <EmptyState title="Select or create a thread" body="Click a diff line to start a thread, or select one from the list." />
            )}

            {loadingThread ? <LoadingState label="Loading thread" /> : null}

            {activeThread ? (
              <div className="thread-comments">
                {activeThread.hasMore ? (
                  <button className="ghost-button" onClick={() => void onLoadOlder()}>
                    Load older comments
                  </button>
                ) : null}
                {activeThread.comments.map((comment) => (
                  <article key={comment.id} className="comment-card">
                    <time>{formatTimestamp(comment.createdAt)}</time>
                    <p>{comment.body}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {(composerAnchor || activeThreadPreview) ? (
              <div className="comment-composer">
                <textarea
                  placeholder={composerAnchor ? "Start the thread…" : "Reply to this thread…"}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  rows={5}
                />
                <button className="primary-button" onClick={() => void submit()}>
                  {composerAnchor ? "Create thread" : "Add comment"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Fragment>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button className="primary-button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state">{label}…</div>;
}

function flattenDiffRows(diff: FileDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of diff.hunks) {
    rows.push({ type: "hunk", id: `${hunk.id}:header`, header: hunk.header });
    for (const line of hunk.lines) {
      rows.push({ type: "line", id: line.id, line });
    }
  }
  return rows;
}

function groupThreadsByLine(threadPreviews: ThreadPreview[]): Map<string, ThreadPreview[]> {
  const map = new Map<string, ThreadPreview[]>();
  for (const thread of threadPreviews) {
    const key = getThreadKey(thread.anchor.oldLine, thread.anchor.newLine);
    const existing = map.get(key) ?? [];
    existing.push(thread);
    map.set(key, existing);
  }
  return map;
}

function getThreadKey(oldLine: number | null, newLine: number | null): string {
  return `${oldLine ?? "x"}:${newLine ?? "x"}`;
}

function toAnchor(filePath: string, line: DiffLine): ThreadAnchor {
  return {
    sessionId: "",
    filePath,
    side: line.newLineNumber !== null ? "new" : "old",
    oldLine: line.oldLineNumber,
    newLine: line.newLineNumber,
    hunkHeader: line.hunkHeader,
    lineContentHash: line.lineContentHash
  };
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}
