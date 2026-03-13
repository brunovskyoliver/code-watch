import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileList } from "@renderer/components/file-list";
import { EmptyState, LoadingState } from "@renderer/components/shared";
import { ThreadPanel } from "@renderer/components/thread-panel";
import {
  createDefaultReviewLayout,
  getNormalizedPaneSizes,
  parseStoredReviewLayout,
  setReviewPaneVisibility,
  type ReviewLayoutState,
  type ReviewPaneId
} from "@renderer/layout/review-layout";
import { useAppStore } from "@renderer/store/app-store";
import type { DiffLine, FileDiff, ThreadAnchor, ThreadPreview } from "@shared/types";

type DiffRow =
  | { type: "hunk"; id: string; header: string }
  | { type: "line"; id: string; line: DiffLine };

interface FlattenedDiffRows {
  rows: DiffRow[];
  isTruncated: boolean;
  renderedLineCount: number;
  totalLineCount: number;
}

const SIDEBAR_WIDTH_KEY = "code-watch.sidebar-width";
const REVIEW_LAYOUT_KEY = "code-watch.review-layout.v1";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const PROJECT_MENU_OFFSET = 6;
const MAX_RENDERED_DIFF_LINES = 1000;
const MIN_PANE_WIDTH = 180;

const paneLabels: Record<ReviewPaneId, string> = {
  files: "Files",
  diff: "Diff",
  threads: "Notes"
};


export default function App() {
  const {
    projects,
    baseBranchesByProject,
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
    selectFile,
    listBranches,
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
  const [reviewLayout, setReviewLayout] = useState<ReviewLayoutState>(() => createDefaultReviewLayout());
  const [draggedPaneId, setDraggedPaneId] = useState<ReviewPaneId | null>(null);
  const [previewPaneOrder, setPreviewPaneOrder] = useState<ReviewPaneId[] | null>(null);
  const [dropTargetPaneId, setDropTargetPaneId] = useState<ReviewPaneId | null>(null);
  const [isBaseBranchMenuOpen, setBaseBranchMenuOpen] = useState(false);
  const [loadingBaseBranches, setLoadingBaseBranches] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);
  const baseBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const reviewLayoutRef = useRef<HTMLDivElement | null>(null);
  const deferredFilePath = useDeferredValue(selectedFilePath);
  const activeDiff = deferredFilePath ? diffsByFile[deferredFilePath] ?? null : null;
  const activeThreadPreviews = selectedFilePath ? threadPreviewsByFile[selectedFilePath] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const baseBranchOptions = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    const availableBranches = baseBranchesByProject[activeProject.id] ?? [];
    const branchSet = new Set(availableBranches);
    branchSet.add(activeProject.defaultBaseBranch);
    return [...branchSet].sort((a, b) => a.localeCompare(b));
  }, [activeProject, baseBranchesByProject]);
  const effectivePaneOrder = previewPaneOrder ?? reviewLayout.order;
  const visibleReviewPanes = useMemo(
    () => effectivePaneOrder.filter((paneId) => reviewLayout.visibility[paneId]),
    [effectivePaneOrder, reviewLayout.visibility]
  );
  const normalizedPaneSizes = useMemo(() => getNormalizedPaneSizes(reviewLayout), [reviewLayout]);
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
    const storedSidebarWidth = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (storedSidebarWidth) {
      const parsedWidth = Number.parseInt(storedSidebarWidth, 10);
      if (!Number.isNaN(parsedWidth)) {
        setSidebarWidth(clampSidebarWidth(parsedWidth));
      }
    }

    setReviewLayout(parseStoredReviewLayout(window.localStorage.getItem(REVIEW_LAYOUT_KEY)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(REVIEW_LAYOUT_KEY, JSON.stringify(reviewLayout));
  }, [reviewLayout]);

  useEffect(() => {
    const closeProjectContextMenu = () => setProjectContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeProjectContextMenu);
    window.addEventListener("resize", closeProjectContextMenu);
    window.addEventListener("scroll", closeProjectContextMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", closeProjectContextMenu);
      window.removeEventListener("resize", closeProjectContextMenu);
      window.removeEventListener("scroll", closeProjectContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setBaseBranchMenuOpen(false);
    setLoadingBaseBranches(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (!isBaseBranchMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!baseBranchMenuRef.current?.contains(target)) {
        setBaseBranchMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBaseBranchMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBaseBranchMenuOpen]);

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

  const beginPaneResize = (event: ReactPointerEvent<HTMLDivElement>, leftPaneId: ReviewPaneId, rightPaneId: ReviewPaneId) => {
    event.preventDefault();

    const containerWidth = reviewLayoutRef.current?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) {
      return;
    }

    const startX = event.clientX;
    const startSizes = getNormalizedPaneSizes(reviewLayout);
    const pairWidth = ((startSizes[leftPaneId] + startSizes[rightPaneId]) / 100) * containerWidth;
    const startLeftWidth = (startSizes[leftPaneId] / 100) * containerWidth;
    document.body.classList.add("is-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rightMinimum = Math.min(getPaneMinimumWidth(rightPaneId), Math.max(MIN_PANE_WIDTH, pairWidth - MIN_PANE_WIDTH));
      const leftMinimum = Math.min(getPaneMinimumWidth(leftPaneId), Math.max(MIN_PANE_WIDTH, pairWidth - MIN_PANE_WIDTH));
      const lowerBound = Math.min(leftMinimum, pairWidth - rightMinimum);
      const upperBound = Math.max(lowerBound, pairWidth - rightMinimum);
      const nextLeftWidth = clamp(startLeftWidth + moveEvent.clientX - startX, lowerBound, upperBound);
      const nextRightWidth = pairWidth - nextLeftWidth;

      setReviewLayout((previous) => ({
        ...previous,
        sizes: {
          ...previous.sizes,
          [leftPaneId]: (nextLeftWidth / containerWidth) * 100,
          [rightPaneId]: (nextRightWidth / containerWidth) * 100
        }
      }));
    };

    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const toggleBaseBranchMenu = () => {
    if (!activeProject) {
      return;
    }

    if (isBaseBranchMenuOpen) {
      setBaseBranchMenuOpen(false);
      return;
    }

    setBaseBranchMenuOpen(true);
    setLoadingBaseBranches(true);
    void listBranches(activeProject.id).finally(() => {
      setLoadingBaseBranches(false);
    });
  };

  const selectBaseBranch = (branch: string) => {
    if (!activeProject) {
      return;
    }

    setBaseBranchMenuOpen(false);
    if (branch !== activeProject.defaultBaseBranch) {
      void updateBaseBranch(activeProject.id, branch);
    }
  };

  const openProjectContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, projectId: string) => {
    event.preventDefault();
    setProjectContextMenu({
      x: event.clientX,
      y: event.clientY + PROJECT_MENU_OFFSET,
      projectId
    });
  };

  const deleteProjectFromContextMenu = () => {
    if (!projectContextMenu) {
      return;
    }

    void removeProject(projectContextMenu.projectId);
    setProjectContextMenu(null);
  };

  const togglePaneVisibility = (paneId: ReviewPaneId) => {
    setReviewLayout((previous) => setReviewPaneVisibility(previous, paneId, !previous.visibility[paneId]));
  };

  const resetPaneLayout = () => {
    setDraggedPaneId(null);
    setPreviewPaneOrder(null);
    setDropTargetPaneId(null);
    setReviewLayout(createDefaultReviewLayout());
  };

  const handlePaneTitleDragStart = (event: ReactDragEvent<HTMLElement>, paneId: ReviewPaneId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", paneId);
    setDraggedPaneId(paneId);
    setPreviewPaneOrder(reviewLayout.order);
    setDropTargetPaneId(null);
  };

  const handlePaneTitleDragOver = (event: ReactDragEvent<HTMLDivElement>, paneId: ReviewPaneId) => {
    if (!draggedPaneId || draggedPaneId === paneId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setPreviewPaneOrder((previous) => reorderPaneOrder(previous ?? reviewLayout.order, draggedPaneId, paneId));
    setDropTargetPaneId(paneId);
  };

  const commitPaneTitleDrag = () => {
    if (draggedPaneId && previewPaneOrder) {
      setReviewLayout((previous) => ({
        ...previous,
        order: previewPaneOrder
      }));
    }

    setDraggedPaneId(null);
    setPreviewPaneOrder(null);
    setDropTargetPaneId(null);
  };

  const handlePaneTitleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    commitPaneTitleDrag();
  };

  const handlePaneTitleDragEnd = () => {
    commitPaneTitleDrag();
  };

  const handlePaneTitleDragLeave = (paneId: ReviewPaneId) => {
    if (dropTargetPaneId === paneId) {
      setDropTargetPaneId(null);
    }
  };

  const renderReviewPane = (paneId: ReviewPaneId) => {
    if (paneId === "files") {
      const hideDisabled = reviewLayout.visibility[paneId] && visibleReviewPanes.length <= 1;
      return (
        <section key={paneId} className="review-pane file-pane">
          <div
            className={`pane-header ${draggedPaneId === paneId ? "pane-header-dragging" : ""} ${
              dropTargetPaneId === paneId ? "pane-header-drop-target" : ""
            }`}
            onDragOver={(event) => handlePaneTitleDragOver(event, paneId)}
            onDragLeave={() => handlePaneTitleDragLeave(paneId)}
            onDrop={handlePaneTitleDrop}
          >
            <h3
              className="pane-title-drag"
              draggable
              title="Drag to reorder panes"
              onDragStart={(event) => handlePaneTitleDragStart(event, paneId)}
              onDragEnd={handlePaneTitleDragEnd}
            >
              Files
            </h3>
            <div className="pane-header-actions">
              <span>{files.length}</span>
              <button
                type="button"
                className="view-toggle"
                disabled={hideDisabled}
                onClick={() => togglePaneVisibility(paneId)}
              >
                {reviewLayout.visibility[paneId] ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {loadingReview ? (
            <LoadingState label="Refreshing" />
          ) : (
            <FileList files={files} selectedFilePath={selectedFilePath} onSelect={selectFile} />
          )}
        </section>
      );
    }

    if (paneId === "diff") {
      const hideDisabled = reviewLayout.visibility[paneId] && visibleReviewPanes.length <= 1;
      return (
        <section key={paneId} className="review-pane diff-pane">
          <div
            className={`pane-header ${draggedPaneId === paneId ? "pane-header-dragging" : ""} ${
              dropTargetPaneId === paneId ? "pane-header-drop-target" : ""
            }`}
            onDragOver={(event) => handlePaneTitleDragOver(event, paneId)}
            onDragLeave={() => handlePaneTitleDragLeave(paneId)}
            onDrop={handlePaneTitleDrop}
          >
            <h3
              className="pane-title-drag"
              draggable
              title="Drag to reorder panes"
              onDragStart={(event) => handlePaneTitleDragStart(event, paneId)}
              onDragEnd={handlePaneTitleDragEnd}
            >
              {selectedFilePath ?? "Diff"}
            </h3>
            <div className="pane-header-actions">
              {loadingDiff ? <span className="loading-pill">Loading</span> : null}
              <button
                type="button"
                className="view-toggle"
                disabled={hideDisabled}
                onClick={() => togglePaneVisibility(paneId)}
              >
                {reviewLayout.visibility[paneId] ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {activeDiff ? (
            <DiffViewer
              sessionId={activeSession!.session.id}
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
      );
    }

    const hideDisabled = reviewLayout.visibility[paneId] && visibleReviewPanes.length <= 1;
    return (
      <section key={paneId} className="review-pane thread-pane">
        <div
          className={`pane-header ${draggedPaneId === paneId ? "pane-header-dragging" : ""} ${
            dropTargetPaneId === paneId ? "pane-header-drop-target" : ""
          }`}
          onDragOver={(event) => handlePaneTitleDragOver(event, paneId)}
          onDragLeave={() => handlePaneTitleDragLeave(paneId)}
          onDrop={handlePaneTitleDrop}
        >
          <h3
            className="pane-title-drag"
            draggable
            title="Drag to reorder panes"
            onDragStart={(event) => handlePaneTitleDragStart(event, paneId)}
            onDragEnd={handlePaneTitleDragEnd}
          >
            Notes
          </h3>
          <div className="pane-header-actions">
            <span>{activeThreadPreviews.length}</span>
            <button
              type="button"
              className="view-toggle"
              disabled={hideDisabled}
              onClick={() => togglePaneVisibility(paneId)}
            >
              {reviewLayout.visibility[paneId] ? "Hide" : "Show"}
            </button>
          </div>
        </div>
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
    );
  };

  return (
    <div className="app-shell" style={shellStyle}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <div>
              <h1 className="brand-title">
                <span className="brand-code">Code</span> <span className="brand-watch">Watch</span>
              </h1>
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
              const isActive = project.id === activeProjectId;

              return (
                <button
                  key={project.id}
                  className={`project-button project-row ${isActive ? "project-row-active" : ""}`}
                  onClick={() => {
                    startTransition(() => {
                      void selectProject(project.id);
                    });
                  }}
                  onContextMenu={(event) => openProjectContextMenu(event, project.id)}
                >
                  <div className="project-copy">
                    <FolderIcon />
                    <strong>{project.name}</strong>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {projectContextMenu ? (
          <div
            className="context-menu"
            style={{ left: `${projectContextMenu.x}px`, top: `${projectContextMenu.y}px` }}
            role="menu"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button className="context-menu-item context-menu-item-danger" role="menuitem" onClick={deleteProjectFromContextMenu}>
              Delete Project
            </button>
          </div>
        ) : null}
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
              <div className="base-branch-control" ref={baseBranchMenuRef}>
                <button
                  type="button"
                  className="base-branch-trigger"
                  aria-label="Base branch"
                  aria-expanded={isBaseBranchMenuOpen}
                  aria-haspopup="listbox"
                  onClick={toggleBaseBranchMenu}
                >
                  {activeProject.defaultBaseBranch}
                </button>
                {isBaseBranchMenuOpen ? (
                  <div className="base-branch-menu" role="listbox" aria-label="Branch list">
                    {loadingBaseBranches ? (
                      <p className="base-branch-menu-state">Loading branches...</p>
                    ) : baseBranchOptions.length > 0 ? (
                      baseBranchOptions.map((branch) => (
                        <button
                          key={branch}
                          type="button"
                          role="option"
                          aria-selected={branch === activeProject.defaultBaseBranch}
                          className={`base-branch-option ${
                            branch === activeProject.defaultBaseBranch ? "base-branch-option-active" : ""
                          }`}
                          onClick={() => selectBaseBranch(branch)}
                        >
                          {branch}
                        </button>
                      ))
                    ) : (
                      <p className="base-branch-menu-state">No branches found.</p>
                    )}
                  </div>
                ) : null}
              </div>
              {activeSession.dirty ? <span className="badge badge-warning">dirty</span> : null}
            </div>
          ) : null}
        </header>

        {initializing ? (
          <LoadingState label="Loading" />
        ) : activeSession ? (
          <>
            <section className="review-toolbar" aria-label="Review layout controls">
              <p className="view-controls-copy">Drag pane titles to reorder. Changes snap when you release.</p>
              <button type="button" className="ghost-button" onClick={resetPaneLayout}>
                Reset layout
              </button>
            </section>

            <div ref={reviewLayoutRef} className="review-layout">
              {visibleReviewPanes.map((paneId, index) => (
                <div
                  key={paneId}
                  className="review-pane-slot"
                  style={{ flexBasis: `${normalizedPaneSizes[paneId]}%` } satisfies CSSProperties}
                >
                  {renderReviewPane(paneId)}
                  {index < visibleReviewPanes.length - 1 ? (
                    <div
                      className="pane-resizer"
                      role="separator"
                      aria-label={`Resize ${paneLabels[paneId]} and ${paneLabels[visibleReviewPanes[index + 1]!]}`}
                      aria-orientation="vertical"
                      onPointerDown={(event) => beginPaneResize(event, paneId, visibleReviewPanes[index + 1]!)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </>
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
  const { rows, isTruncated, renderedLineCount, totalLineCount } = useMemo(() => flattenDiffRows(diff), [diff]);
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
    <>
      {isTruncated ? (
        <div className="diff-truncate-notice">
          Showing first {renderedLineCount} of {totalLineCount} lines for performance.
        </div>
      ) : null}
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
    </>
  );
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

function flattenDiffRows(diff: FileDiff): FlattenedDiffRows {
  const rows: DiffRow[] = [];
  let renderedLineCount = 0;
  let totalLineCount = 0;

  for (const hunk of diff.hunks) {
    totalLineCount += hunk.lines.length;
    if (renderedLineCount >= MAX_RENDERED_DIFF_LINES) {
      continue;
    }

    rows.push({ type: "hunk", id: `${hunk.id}:header`, header: hunk.header });
    for (const line of hunk.lines) {
      if (renderedLineCount >= MAX_RENDERED_DIFF_LINES) {
        break;
      }
      rows.push({ type: "line", id: line.id, line });
      renderedLineCount += 1;
    }
  }

  return {
    rows,
    isTruncated: totalLineCount > renderedLineCount,
    renderedLineCount,
    totalLineCount
  };
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

function reorderPaneOrder(order: ReviewPaneId[], draggedPaneId: ReviewPaneId, targetPaneId: ReviewPaneId): ReviewPaneId[] {
  const fromIndex = order.indexOf(draggedPaneId);
  const toIndex = order.indexOf(targetPaneId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return order;
  }

  const nextOrder = [...order];
  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, draggedPaneId);
  return nextOrder;
}

function toAnchor(filePath: string, line: DiffLine): Omit<ThreadAnchor, "sessionId"> {
  return {
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

function clampSidebarWidth(value: number): number {
  return clamp(value, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

function getPaneMinimumWidth(paneId: ReviewPaneId): number {
  switch (paneId) {
    case "files":
      return 220;
    case "threads":
      return 260;
    case "diff":
    default:
      return 320;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
