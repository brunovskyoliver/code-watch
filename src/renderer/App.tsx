import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CommandPaletteDialog } from "@renderer/components/command-palette";
import { FileList } from "@renderer/components/file-list";
import { EmptyState, LoadingState } from "@renderer/components/shared";
import { ThreadPanel } from "@renderer/components/thread-panel";
import {
  createBranchCommandMenuItems,
  filterCommandMenuItems,
  type CommandMenuItem
} from "@renderer/command-menu";
import {
  createDefaultReviewLayout,
  getNormalizedPaneSizes,
  getReviewLayoutStorageKey,
  readStoredReviewLayout,
  reorderReviewPanes,
  setReviewPaneVisibility,
  type ReviewLayoutState,
  type ReviewPaneId
} from "@renderer/layout/review-layout";
import { useAppStore } from "@renderer/store/app-store";
import type { DiffLine, FileDiff, FileSearchResult, ThreadAnchor, ThreadPreview } from "@shared/types";
import { FolderInput, Files, FileDiff as FDiff, NotebookPen, X } from 'lucide-react';

type DiffRow =
  | { type: "hunk"; id: string; header: string }
  | { type: "line"; id: string; line: DiffLine };

type CommandMenuView =
  | { type: "root" }
  | { type: "switch-branch"; projectId: string; projectName: string };

interface FlattenedDiffRows {
  rows: DiffRow[];
  isTruncated: boolean;
  renderedLineCount: number;
  totalLineCount: number;
}

const SIDEBAR_WIDTH_KEY = "code-watch.sidebar-width";
const DEFAULT_MIN_SIDEBAR_WIDTH = 235;
const MAX_SIDEBAR_WIDTH = 360;
const PROJECT_MENU_OFFSET = 6;
const MAX_RENDERED_DIFF_LINES = 1000;
const MIN_PANE_WIDTH = 180;
const FILE_SEARCH_LIMIT = 5;
const FILE_SEARCH_DEBOUNCE_MS = 120;

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
    openFiles,
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
    reorderProjects,
    removeProject,
    selectProject,
    refreshProject,
    selectSession,
    selectFile,
    closeFile,
    reorderOpenFiles,
    listBranches,
    updateBaseBranch,
    searchFiles,
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

  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [sidebarMinWidth, setSidebarMinWidth] = useState(DEFAULT_MIN_SIDEBAR_WIDTH);
  const [reviewLayout, setReviewLayout] = useState<ReviewLayoutState>(() => createDefaultReviewLayout());
  const [layoutProjectId, setLayoutProjectId] = useState<string | null>(null);
  const [draggedPaneId, setDraggedPaneId] = useState<ReviewPaneId | null>(null);
  const [dropTargetPaneId, setDropTargetPaneId] = useState<ReviewPaneId | null>(null);
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dropTargetTab, setDropTargetTab] = useState<string | null>(null);
  const [isBaseBranchMenuOpen, setBaseBranchMenuOpen] = useState(false);
  const [loadingBaseBranches, setLoadingBaseBranches] = useState(false);
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const [isCommandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandMenuView, setCommandMenuView] = useState<CommandMenuView>({ type: "root" });
  const [commandMenuQuery, setCommandMenuQuery] = useState("");
  const [commandMenuSelectedIndex, setCommandMenuSelectedIndex] = useState(0);
  const [isFileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<FileSearchResult[]>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchSelectedIndex, setFileSearchSelectedIndex] = useState(0);
  const baseBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarHeaderRef = useRef<HTMLDivElement | null>(null);
  const sidebarTitleRef = useRef<HTMLDivElement | null>(null);
  const sidebarAddRepoButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandMenuInputRef = useRef<HTMLInputElement | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reviewLayoutRef = useRef<HTMLDivElement | null>(null);
  const deferredFilePath = useDeferredValue(selectedFilePath);
  const activeDiff = deferredFilePath ? diffsByFile[deferredFilePath] ?? null : null;
  const activeThreadPreviews = selectedFilePath ? threadPreviewsByFile[selectedFilePath] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjectBranches = activeProjectId ? baseBranchesByProject[activeProjectId] ?? [] : [];
  const branchPickerProjectId = commandMenuView.type === "switch-branch" ? commandMenuView.projectId : activeProjectId;
  const branchPickerProject =
    commandMenuView.type === "switch-branch"
      ? projects.find((project) => project.id === commandMenuView.projectId) ?? null
      : activeProject;
  const branchPickerBranches = branchPickerProjectId ? baseBranchesByProject[branchPickerProjectId] ?? [] : [];
  const baseBranchOptions = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    const availableBranches = baseBranchesByProject[activeProject.id] ?? [];
    const branchSet = new Set(availableBranches);
    branchSet.add(activeProject.defaultBaseBranch);
    return [...branchSet].sort((a, b) => a.localeCompare(b));
  }, [activeProject, baseBranchesByProject]);
  const commandMenuItems = useMemo(
    () => [
      ...(activeProject
        ? [
          {
            id: "switch-review-branch",
            title: "Switch Review Branch",
            subtitle: `Choose a base branch for ${activeProject.name}`,
            keywords: ["branch", "base", "review", "switch", "compare"],
            execute: () => void showBranchPicker(activeProject.id, activeProject.name)
          }
        ]
        : []),
      {
        id: "search-files",
        title: "Search Files",
        subtitle: "Jump to changed files across projects",
        keywords: ["open", "find", "palette"],
        execute: () => openFileSearch()
      },
      {
        id: "add-project",
        title: "Add Repository",
        subtitle: "Add a local Git repository",
        keywords: ["repo", "project", "folder"],
        execute: () => {
          closeCommandMenu();
          void addProject();
        }
      }
    ] satisfies Array<CommandMenuItem & { execute: () => void }>,
    [activeProject, addProject]
  );
  const visibleCommandMenuItems = useMemo(() => {
    if (commandMenuView.type === "root") {
      return filterCommandMenuItems(commandMenuItems, commandMenuQuery);
    }

    if (loadingBaseBranches && branchPickerBranches.length === 0) {
      return [];
    }

    return filterCommandMenuItems(
      createBranchCommandMenuItems(
        commandMenuView.projectId,
        toUniqueBranches(branchPickerBranches, branchPickerProject?.defaultBaseBranch ?? null),
        branchPickerProject?.defaultBaseBranch ?? null
      ),
      commandMenuQuery
    ).map((item) => ({
      ...item,
      execute: () => {
        closeCommandMenu();
        if (item.branch !== branchPickerProject?.defaultBaseBranch) {
          void updateBaseBranch(item.projectId, item.branch);
        }
      }
    }));
  }, [
    branchPickerBranches,
    branchPickerProject?.defaultBaseBranch,
    commandMenuItems,
    commandMenuQuery,
    commandMenuView,
    loadingBaseBranches,
    updateBaseBranch
  ]);
  const effectivePaneOrder = reviewLayout.order;
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
        setSidebarWidth(parsedWidth);
      }
    }
  }, []);

  useLayoutEffect(() => {
    const sidebarHeader = sidebarHeaderRef.current;
    const sidebarTitle = sidebarTitleRef.current;
    const addRepoButton = sidebarAddRepoButtonRef.current;
    if (!sidebarHeader || !sidebarTitle || !addRepoButton) {
      return;
    }

    const measureSidebarMinimumWidth = () => {
      const computedStyles = window.getComputedStyle(sidebarHeader);
      const gapValue = Number.parseFloat(computedStyles.columnGap || computedStyles.gap || "0") || 0;
      const paddingLeft = Number.parseFloat(computedStyles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(computedStyles.paddingRight) || 0;
      const requiredWidth = Math.ceil(
        sidebarTitle.scrollWidth + addRepoButton.getBoundingClientRect().width + gapValue + paddingLeft + paddingRight
      );

      setSidebarMinWidth(Math.max(DEFAULT_MIN_SIDEBAR_WIDTH, requiredWidth));
    };

    measureSidebarMinimumWidth();

    const resizeObserver = new ResizeObserver(measureSidebarMinimumWidth);
    resizeObserver.observe(sidebarHeader);
    resizeObserver.observe(sidebarTitle);
    resizeObserver.observe(addRepoButton);
    window.addEventListener("resize", measureSidebarMinimumWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureSidebarMinimumWidth);
    };
  }, []);

  useEffect(() => {
    setSidebarWidth((previousWidth) => clampSidebarWidth(previousWidth, sidebarMinWidth));
  }, [sidebarMinWidth]);

  useEffect(() => {
    if (!activeProjectId) {
      setReviewLayout(createDefaultReviewLayout());
      setLayoutProjectId(null);
      return;
    }

    setReviewLayout(readStoredReviewLayout(window.localStorage, activeProjectId));
    setLayoutProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!layoutProjectId || layoutProjectId !== activeProjectId) {
      return;
    }

    window.localStorage.setItem(getReviewLayoutStorageKey(layoutProjectId), JSON.stringify(reviewLayout));
  }, [activeProjectId, layoutProjectId, reviewLayout]);

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
      document.body.classList.remove("is-pane-dragging");
    },
    []
  );

  useEffect(() => {
    if (!isCommandMenuOpen && !isFileSearchOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (isCommandMenuOpen) {
        commandMenuInputRef.current?.focus();
        return;
      }

      fileSearchInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isCommandMenuOpen, isFileSearchOpen]);

  useEffect(() => {
    if (!isCommandMenuOpen) {
      setCommandMenuView({ type: "root" });
      setCommandMenuQuery("");
      setCommandMenuSelectedIndex(0);
      return;
    }

    setCommandMenuSelectedIndex((index) => clamp(index, 0, Math.max(0, visibleCommandMenuItems.length - 1)));
  }, [isCommandMenuOpen, visibleCommandMenuItems.length]);

  useEffect(() => {
    if (!isFileSearchOpen) {
      setFileSearchResults([]);
      setFileSearchLoading(false);
      setFileSearchSelectedIndex(0);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setFileSearchLoading(true);
      void searchFiles(fileSearchQuery, FILE_SEARCH_LIMIT)
        .then((results) => {
          if (cancelled) {
            return;
          }
          setFileSearchResults(results);
          setFileSearchSelectedIndex((index) => clamp(index, 0, Math.max(0, results.length - 1)));
        })
        .finally(() => {
          if (!cancelled) {
            setFileSearchLoading(false);
          }
        });
    }, FILE_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isFileSearchOpen, fileSearchQuery, searchFiles]);

  useEffect(() => {
    const handleGlobalFileSearchKeys = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "w" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        const { selectedFilePath, closeFile: closeFileAction } = useAppStore.getState();
        if (selectedFilePath) {
          void closeFileAction(selectedFilePath);
        }
        return;
      }

      if (event.key === "/" && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        openCommandMenu();
        return;
      }

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        openFileSearch();
        return;
      }

      if (isCommandMenuOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (commandMenuView.type === "root") {
            closeCommandMenu();
          } else {
            showCommandMenuRoot();
          }
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setCommandMenuSelectedIndex((index) => clamp(index + 1, 0, Math.max(0, visibleCommandMenuItems.length - 1)));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setCommandMenuSelectedIndex((index) => clamp(index - 1, 0, Math.max(0, visibleCommandMenuItems.length - 1)));
          return;
        }

        if (event.key === "Enter") {
          const selectedCommand = visibleCommandMenuItems[commandMenuSelectedIndex];
          if (!selectedCommand) {
            return;
          }

          event.preventDefault();
          selectedCommand.execute();
        }

        return;
      }

      if (!isFileSearchOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setFileSearchOpen(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFileSearchSelectedIndex((index) => clamp(index + 1, 0, Math.max(0, fileSearchResults.length - 1)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFileSearchSelectedIndex((index) => clamp(index - 1, 0, Math.max(0, fileSearchResults.length - 1)));
        return;
      }

      if (event.key === "Enter") {
        const selectedResult = fileSearchResults[fileSearchSelectedIndex];
        if (!selectedResult) {
          return;
        }
        event.preventDefault();
        void applyFileSearchResult(selectedResult);
      }
    };

    window.addEventListener("keydown", handleGlobalFileSearchKeys);
    return () => {
      window.removeEventListener("keydown", handleGlobalFileSearchKeys);
    };
  }, [
    commandMenuSelectedIndex,
    commandMenuView.type,
    isCommandMenuOpen,
    isFileSearchOpen,
    fileSearchResults,
    fileSearchSelectedIndex,
    visibleCommandMenuItems
  ]);

  async function applyFileSearchResult(result: FileSearchResult) {
    closeFileSearch();
    const state = useAppStore.getState();
    if (state.activeProjectId !== result.projectId) {
      await selectProject(result.projectId);
    }
    const nextState = useAppStore.getState();
    if (nextState.activeSession?.session.id !== result.sessionId) {
      await selectSession(result.projectId, result.sessionId);
    }
    await selectFile(result.filePath);
  }

  function closeCommandMenu() {
    setCommandMenuOpen(false);
    setCommandMenuView({ type: "root" });
    setCommandMenuQuery("");
    setCommandMenuSelectedIndex(0);
  }

  function showCommandMenuRoot() {
    setCommandMenuView({ type: "root" });
    setCommandMenuQuery("");
    setCommandMenuSelectedIndex(0);
  }

  async function showBranchPicker(projectId: string, projectName: string) {
    setCommandMenuView({ type: "switch-branch", projectId, projectName });
    setCommandMenuQuery("");
    setCommandMenuSelectedIndex(0);

    setLoadingBaseBranches(true);
    try {
      await listBranches(projectId);
    } finally {
      setLoadingBaseBranches(false);
    }
  }

  function closeFileSearch() {
    setFileSearchOpen(false);
    setFileSearchQuery("");
    setFileSearchSelectedIndex(0);
  }

  function openCommandMenu() {
    setBaseBranchMenuOpen(false);
    setProjectContextMenu(null);
    closeFileSearch();
    showCommandMenuRoot();
    setCommandMenuOpen(true);
  }

  function openFileSearch() {
    setBaseBranchMenuOpen(false);
    setProjectContextMenu(null);
    closeCommandMenu();
    setFileSearchQuery("");
    setFileSearchSelectedIndex(0);
    setFileSearchOpen(true);
  }

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("is-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX, sidebarMinWidth));
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

  const clearProjectDragState = () => {
    document.body.classList.remove("is-pane-dragging");
    setDraggedProjectId(null);
    setDropTargetProjectId(null);
  };

  const beginProjectReorder = (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
    document.body.classList.add("is-pane-dragging");
    setDraggedProjectId(projectId);
    setDropTargetProjectId(projectId);
  };

  const handleProjectDragOver = (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => {
    if (!draggedProjectId || draggedProjectId === projectId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetProjectId !== projectId) {
      setDropTargetProjectId(projectId);
    }
  };

  const handleProjectDrop = (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => {
    if (!draggedProjectId) {
      return;
    }

    event.preventDefault();
    if (draggedProjectId !== projectId) {
      const reorderedProjectIds = reorderIdList(
        projects.map((project) => project.id),
        draggedProjectId,
        projectId
      );
      if (reorderedProjectIds.length > 0) {
        void reorderProjects(reorderedProjectIds);
      }
    }
    clearProjectDragState();
  };

  const togglePaneVisibility = (paneId: ReviewPaneId) => {
    setReviewLayout((previous) => setReviewPaneVisibility(previous, paneId, !previous.visibility[paneId]));
  };

  const clearPaneDragState = () => {
    document.body.classList.remove("is-pane-dragging");
    setDraggedPaneId(null);
    setDropTargetPaneId(null);
  };

  const beginPaneReorder = (event: ReactDragEvent<HTMLElement>, paneId: ReviewPaneId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", paneId);
    document.body.classList.add("is-pane-dragging");
    setDraggedPaneId(paneId);
    setDropTargetPaneId(paneId);
  };

  const handlePaneHeaderDragOver = (event: ReactDragEvent<HTMLElement>, paneId: ReviewPaneId) => {
    if (!draggedPaneId || draggedPaneId === paneId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetPaneId !== paneId) {
      setDropTargetPaneId(paneId);
    }
  };

  const handlePaneHeaderDrop = (event: ReactDragEvent<HTMLElement>, paneId: ReviewPaneId) => {
    if (!draggedPaneId) {
      return;
    }

    event.preventDefault();
    if (draggedPaneId !== paneId) {
      setReviewLayout((previous) => reorderReviewPanes(previous, draggedPaneId, paneId));
    }
    clearPaneDragState();
  };

  const renderReviewPane = (paneId: ReviewPaneId) => {
    if (paneId === "files") {
      return (
        <section key={paneId} className="review-pane file-pane">
          <div
            className={`pane-header pane-header-draggable ${draggedPaneId === paneId ? "pane-header-dragging" : ""
              } ${dropTargetPaneId === paneId && draggedPaneId !== paneId ? "pane-header-drop-target" : ""}`}
            draggable
            onDragStart={(event) => beginPaneReorder(event, paneId)}
            onDragOver={(event) => handlePaneHeaderDragOver(event, paneId)}
            onDrop={(event) => handlePaneHeaderDrop(event, paneId)}
            onDragEnd={clearPaneDragState}
          >
            <h3>Files</h3>
            <div className="pane-header-actions">
              <span>{files.length}</span>
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
      return (
        <section key={paneId} className="review-pane diff-pane">
          <div
            className={`pane-header pane-header-draggable ${draggedPaneId === paneId ? "pane-header-dragging" : ""
              } ${dropTargetPaneId === paneId && draggedPaneId !== paneId ? "pane-header-drop-target" : ""}`}
            draggable
            onDragStart={(event) => beginPaneReorder(event, paneId)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/vnd.code-watch.file") || event.dataTransfer.types.includes("application/vnd.code-watch.tab")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              } else {
                handlePaneHeaderDragOver(event, paneId);
              }
            }}
            onDrop={(event) => {
              if (event.dataTransfer.types.includes("application/vnd.code-watch.tab")) {
                event.preventDefault();
                event.stopPropagation();
                const draggedFile = event.dataTransfer.getData("application/vnd.code-watch.tab");
                if (draggedFile) {
                  const newOpenFiles = openFiles.filter(f => f !== draggedFile);
                  newOpenFiles.push(draggedFile);
                  reorderOpenFiles(newOpenFiles);
                }
                setDraggedTab(null);
                setDropTargetTab(null);
              } else if (event.dataTransfer.types.includes("application/vnd.code-watch.file")) {
                event.preventDefault();
                event.stopPropagation();
                const droppedFile = event.dataTransfer.getData("application/vnd.code-watch.file");
                if (droppedFile) {
                  void selectFile(droppedFile);
                }
                setDropTargetPaneId(null);
              } else {
                handlePaneHeaderDrop(event, paneId);
              }
            }}
            onDragEnd={clearPaneDragState}
          >
            <div className="diff-tabs" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
              {openFiles.length > 0 ? (
                openFiles.map((file) => {
                  const isActive = file === selectedFilePath;
                  return (
                    <div
                      key={file}
                      className={`diff-tab ${isActive ? "diff-tab-active" : ""} ${draggedTab === file ? "diff-tab-dragging" : ""
                        } ${dropTargetTab === file && draggedTab !== file ? "diff-tab-drop-target" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("application/vnd.code-watch.tab", file);
                        setDraggedTab(file);
                        setDropTargetTab(file);
                      }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("application/vnd.code-watch.tab")) {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dropTargetTab !== file) setDropTargetTab(file);
                        }
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const draggedFile = e.dataTransfer.getData("application/vnd.code-watch.tab");
                        if (draggedFile && draggedFile !== file) {
                          const newOpenFiles = reorderIdList(openFiles, draggedFile, file);
                          if (newOpenFiles.length > 0) reorderOpenFiles(newOpenFiles);
                        }
                        setDraggedTab(null);
                        setDropTargetTab(null);
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        setDraggedTab(null);
                        setDropTargetTab(null);
                      }}
                      onClick={() => {
                        if (!isActive) {
                          void selectFile(file);
                        }
                      }}
                    >
                      <span className="diff-tab-label">{file.split('/').pop() || file}</span>
                      <button
                        className="diff-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void closeFile(file);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })
              ) : (
                <h3>Diff</h3>
              )}
            </div>
            <div className="pane-header-actions">
              {loadingDiff ? <span className="loading-pill">Loading</span> : null}
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

    return (
      <section key={paneId} className="review-pane thread-pane">
        <div
          className={`pane-header pane-header-draggable ${draggedPaneId === paneId ? "pane-header-dragging" : ""
            } ${dropTargetPaneId === paneId && draggedPaneId !== paneId ? "pane-header-drop-target" : ""}`}
          draggable
          onDragStart={(event) => beginPaneReorder(event, paneId)}
          onDragOver={(event) => handlePaneHeaderDragOver(event, paneId)}
          onDrop={(event) => handlePaneHeaderDrop(event, paneId)}
          onDragEnd={clearPaneDragState}
        >
          <h3>Notes</h3>
          <div className="pane-header-actions">
            <span>{activeThreadPreviews.length}</span>
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
        <div className="sidebar-header" ref={sidebarHeaderRef}>
          <div className="sidebar-title" ref={sidebarTitleRef}>
            <div>
              <h1 className="brand-title">
                <span className="brand-code">Code</span> <span className="brand-watch">Watch</span>
              </h1>
              <p>{projects.length} repo{projects.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <button
            ref={sidebarAddRepoButtonRef}
            className="ghost-button"
            onClick={() => void addProject()}
            aria-label="Add repository"
          >
            <FolderInput style={{ paddingTop: "25%" }} />
          </button>
        </div>

        <div className="sidebar-scroll">
          {projects.length === 0 ? (
            <EmptyState title="No repos" body="Add a local Git repo." actionLabel="+" onAction={() => void addProject()} />
          ) : (
            projects.map((project) => {
              const isActive = project.id === activeProjectId;

              return (
                <button
                  key={project.id}
                  className={`project-button project-row ${isActive ? "project-row-active" : ""} ${draggedProjectId === project.id ? "project-row-dragging" : ""
                    } ${dropTargetProjectId === project.id && draggedProjectId !== project.id ? "project-row-drop-target" : ""
                    }`}
                  draggable
                  onDragStart={(event) => beginProjectReorder(event, project.id)}
                  onDragOver={(event) => handleProjectDragOver(event, project.id)}
                  onDrop={(event) => handleProjectDrop(event, project.id)}
                  onDragEnd={clearProjectDragState}
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
            <div className="topbar-actions">
              <div className="pane-toolbar" role="toolbar" aria-label="Toggle review panes">
                <button
                  type="button"
                  className={`pane-toolbar-button ${reviewLayout.visibility.files ? "pane-toolbar-button-active" : ""}`}
                  aria-pressed={reviewLayout.visibility.files}
                  aria-label="Toggle files pane"
                  onClick={() => togglePaneVisibility("files")}
                >
                  <Files />
                </button>
                <button
                  type="button"
                  className={`pane-toolbar-button ${reviewLayout.visibility.diff ? "pane-toolbar-button-active" : ""}`}
                  aria-pressed={reviewLayout.visibility.diff}
                  aria-label="Toggle diff pane"
                  onClick={() => togglePaneVisibility("diff")}
                >
                  <FDiff />
                </button>
                <button
                  type="button"
                  className={`pane-toolbar-button ${reviewLayout.visibility.threads ? "pane-toolbar-button-active" : ""}`}
                  aria-pressed={reviewLayout.visibility.threads}
                  aria-label="Toggle notes pane"
                  onClick={() => togglePaneVisibility("threads")}
                >
                  <NotebookPen />
                </button>
              </div>
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
                    <div
                      className="base-branch-menu"
                      role="listbox"
                      aria-label="Branch list"
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerMove={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onWheel={(event) => event.stopPropagation()}
                    >
                      {loadingBaseBranches ? (
                        <p className="base-branch-menu-state">Loading branches...</p>
                      ) : baseBranchOptions.length > 0 ? (
                        baseBranchOptions.map((branch) => (
                          <button
                            key={branch}
                            type="button"
                            role="option"
                            aria-selected={branch === activeProject.defaultBaseBranch}
                            className={`base-branch-option ${branch === activeProject.defaultBaseBranch ? "base-branch-option-active" : ""
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
            </div>
          ) : null}
        </header>

        {initializing ? (
          <LoadingState label="Loading" />
        ) : activeSession ? (
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
        ) : (
          <EmptyState title="Add a repo" body="Open a local Git repo to start." actionLabel="+" onAction={() => void addProject()} />
        )}
      </main>

      <CommandPaletteDialog
        open={isCommandMenuOpen}
        label={commandMenuView.type === "root" ? "Command menu" : "Switch review branch"}
        value={commandMenuQuery}
        placeholder={commandMenuView.type === "root" ? "Search commands" : "Search branches"}
        inputRef={commandMenuInputRef}
        selectedItemId={visibleCommandMenuItems[commandMenuSelectedIndex]?.id ?? null}
        onClose={closeCommandMenu}
        onValueChange={(value) => {
          setCommandMenuQuery(value);
          setCommandMenuSelectedIndex(0);
        }}
      >
        {visibleCommandMenuItems.length === 0 ? (
          <p className="command-palette-state">
            {commandMenuView.type === "root"
              ? "No matching commands."
              : !branchPickerProject
                ? "No project selected."
                : loadingBaseBranches
                  ? `Loading branches for ${branchPickerProject.name}...`
                  : branchPickerBranches.length === 0
                    ? `No branches found for ${branchPickerProject.name}.`
                    : "No matching branches."
            }
          </p>
        ) : (
          visibleCommandMenuItems.map((command, index) => (
            <button
              key={command.id}
              className={`command-palette-item ${index === commandMenuSelectedIndex ? "command-palette-item-active" : ""}`}
              data-command-palette-selected={index === commandMenuSelectedIndex ? "true" : undefined}
              onMouseEnter={() => setCommandMenuSelectedIndex(index)}
              onClick={() => command.execute()}
            >
              <div className="command-palette-item-main">
                <strong>{command.title}</strong>
                <p>{command.subtitle}</p>
              </div>
            </button>
          ))
        )}
      </CommandPaletteDialog>

      <CommandPaletteDialog
        open={isFileSearchOpen}
        label="Search files"
        value={fileSearchQuery}
        placeholder="Search files across projects"
        inputRef={fileSearchInputRef}
        selectedItemId={fileSearchResults[fileSearchSelectedIndex]
          ? `${fileSearchResults[fileSearchSelectedIndex]!.projectId}:${fileSearchResults[fileSearchSelectedIndex]!.sessionId}:${fileSearchResults[fileSearchSelectedIndex]!.filePath}`
          : null}
        onClose={closeFileSearch}
        onValueChange={(value) => {
          setFileSearchQuery(value);
          setFileSearchSelectedIndex(0);
        }}
      >
        {fileSearchLoading && fileSearchResults.length === 0 ? (
          <p className="command-palette-state">Searching...</p>
        ) : fileSearchResults.length === 0 ? (
          <p className="command-palette-state">No matching files.</p>
        ) : (
          fileSearchResults.map((result, index) => (
            <button
              key={`${result.projectId}:${result.sessionId}:${result.filePath}`}
              className={`command-palette-item ${index === fileSearchSelectedIndex ? "command-palette-item-active" : ""}`}
              data-command-palette-selected={index === fileSearchSelectedIndex ? "true" : undefined}
              onMouseEnter={() => setFileSearchSelectedIndex(index)}
              onClick={() => {
                void applyFileSearchResult(result);
              }}
            >
              <div className="command-palette-item-main">
                <strong>{result.filePath}</strong>
                <p>{result.projectName}</p>
              </div>
            </button>
          ))
        )}
      </CommandPaletteDialog>

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

function FilesPaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h10.5" />
    </svg>
  );
}

function DiffPaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 4.5v15m0 0 3-3m-3 3-3-3m9-9h3m-3 6h3" />
    </svg>
  );
}

function NotesPaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 5.25h10.5A2.25 2.25 0 0 1 19.5 7.5v6.75a2.25 2.25 0 0 1-2.25 2.25H12l-3.75 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25V7.5a2.25 2.25 0 0 1 2.25-2.25Z"
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (target.isContentEditable) {
    return true;
  }
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function clampSidebarWidth(value: number, minSidebarWidth: number): number {
  return clamp(value, minSidebarWidth, MAX_SIDEBAR_WIDTH);
}

function toUniqueBranches(branches: string[], preferredBranch: string | null): string[] {
  const branchSet = new Set(branches);
  if (preferredBranch) {
    branchSet.add(preferredBranch);
  }

  return [...branchSet].sort((a, b) => a.localeCompare(b));
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

function reorderIdList(ids: string[], sourceId: string, targetId: string): string[] {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return [];
  }

  const next = [...ids];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return [];
  }

  next.splice(targetIndex, 0, moved);
  return next;
}
