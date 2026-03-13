import {
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "@renderer/store/app-store";
import type { ChangedFile, DiffLine, FileDiff, PaginatedComments, ThreadAnchor, ThreadPreview } from "@shared/types";

type DiffRow =
  | { type: "hunk"; id: string; header: string }
  | { type: "line"; id: string; line: DiffLine };

const SIDEBAR_WIDTH_KEY = "code-watch.sidebar-width";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;

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

  const [sidebarWidth, setSidebarWidth] = useState(288);
  const deferredFilePath = useDeferredValue(selectedFilePath);
  const activeDiff = deferredFilePath ? diffsByFile[deferredFilePath] ?? null : null;
  const activeThreadPreviews = selectedFilePath ? threadPreviewsByFile[selectedFilePath] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const shellStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

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

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!stored) {
      return;
    }

    const parsed = Number.parseInt(stored, 10);
    if (!Number.isNaN(parsed)) {
      setSidebarWidth(clampSidebarWidth(parsed));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(
    () => () => {
      document.body.classList.remove("is-resizing");
    },
    []
  );

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("is-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className="app-shell" style={shellStyle}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <span className="app-mark" aria-hidden="true" />
            <div>
              <h1>Code Watch</h1>
              <p>{projects.length} repo{projects.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <button className="ghost-button" onClick={() => void addProject()} aria-label="Add repository">
            Add
          </button>
        </div>

        <div className="sidebar-scroll">
          {projects.length === 0 ? (
            <EmptyState title="No repos" body="Add a local Git repo." actionLabel="Add" onAction={() => void addProject()} />
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
                    <div className="project-copy">
                      <FolderIcon />
                      <strong>{project.name}</strong>
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
                      <button className="danger-button subtle-danger-button" onClick={() => void removeProject(project.id)}>
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

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onPointerDown={beginSidebarResize}
      />

      <main className="main-pane">
        <header className="topbar">
          <div className="topbar-title">
            <h2>{activeSession ? activeSession.project.name : "Code Watch"}</h2>
            <p>
              {activeSession
                ? `${activeSession.session.branchName} · ${shortSha(activeSession.session.headSha)}`
                : "Local review"}
            </p>
          </div>

          {activeSession && activeProject ? (
            <div className="topbar-meta">
              <span className="badge">{activeSession.project.currentBranch ?? "head"}</span>
              <label className="base-branch-control">
                <span>Base</span>
                <input
                  aria-label="Base branch"
                  defaultValue={activeProject.defaultBaseBranch}
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value && value !== activeProject.defaultBaseBranch) {
                      void updateBaseBranch(activeProject.id, value);
                    }
                  }}
                />
              </label>
              {activeSession.dirty ? <span className="badge badge-warning">dirty</span> : null}
            </div>
          ) : null}
        </header>

        {initializing ? (
          <LoadingState label="Loading" />
        ) : activeSession ? (
          <div className="review-layout">
            <section className="file-pane">
              <div className="pane-header">
                <h3>Files</h3>
                <span>{files.length}</span>
              </div>
              {loadingReview ? (
                <LoadingState label="Refreshing" />
              ) : (
                <FileList files={files} selectedFilePath={selectedFilePath} onSelect={selectFile} />
              )}
            </section>

            <section className="diff-pane">
              <div className="pane-header">
                <h3>{selectedFilePath ?? "Diff"}</h3>
                {loadingDiff ? <span className="loading-pill">Loading</span> : null}
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
                <LoadingState label="Loading diff" />
              ) : (
                <EmptyState title="No files" body="No committed changes." />
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
          <EmptyState title="Add a repo" body="Open a local Git repo to start." actionLabel="Add" onAction={() => void addProject()} />
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
        <h4>Binary</h4>
        <p>Preview is off in v1.</p>
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
                  {threads.length}
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
        <h3>Notes</h3>
        <span>{threadPreviews.length}</span>
      </div>

      {!filePath ? (
        <EmptyState title="Pick a file" body="Notes show up here." />
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
                      <span>{thread.anchor.newLine ?? thread.anchor.oldLine ?? "?"}</span>
                      <span className={`status-pill status-pill-${thread.status}`}>{thread.status}</span>
                    </div>
                    <p>{latestComment?.body ?? "No comments"}</p>
                    {thread.remainingCommentCount > 0 ? (
                      <small>{thread.remainingCommentCount} older</small>
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
                  <h4>New note</h4>
                  <button className="ghost-button" onClick={onCancelComposer}>
                    Cancel
                  </button>
                </div>
                <p className="thread-meta">Line {composerAnchor.newLine ?? composerAnchor.oldLine ?? "?"}</p>
              </Fragment>
            ) : activeThreadPreview ? (
              <Fragment>
                <div className="thread-detail-header">
                  <div>
                    <h4>Note</h4>
                    <p className="thread-meta">Line {activeThreadPreview.anchor.newLine ?? activeThreadPreview.anchor.oldLine ?? "?"}</p>
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
              <EmptyState title="No note" body="Click a diff line to start." />
            )}

            {loadingThread ? <LoadingState label="Loading" /> : null}

            {activeThread ? (
              <div className="thread-comments">
                {activeThread.hasMore ? (
                  <button className="ghost-button" onClick={() => void onLoadOlder()}>
                    Older
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
                  placeholder={composerAnchor ? "Start a note…" : "Reply…"}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  rows={5}
                />
                <button className="primary-button" onClick={() => void submit()}>
                  {composerAnchor ? "Create" : "Reply"}
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

function FolderIcon() {
  return (
    <svg
      className="project-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V7.5A2.25 2.25 0 0 1 4.5 5.25h5.379a2.25 2.25 0 0 1 1.591.659l1.371 1.371a2.25 2.25 0 0 0 1.591.659h5.068A2.25 2.25 0 0 1 21.75 10.5v2.25m-19.5 0v4.5A2.25 2.25 0 0 0 4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25v-4.5m-19.5 0h19.5"
      />
    </svg>
  );
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

function clampSidebarWidth(value: number): number {
  return Math.min(Math.max(value, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
}
