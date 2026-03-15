import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { NotificationList, type WorkflowNotification } from "@renderer/components/notification-list";
import { EmptyState, LoadingState } from "@renderer/components/shared";
import { ThreadPanel } from "@renderer/components/thread-panel";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider
} from "@renderer/components/ui/sidebar";
import {
  createBranchCommandMenuItems,
  filterCommandMenuItems,
  type CommandMenuItem
} from "@renderer/command-menu";
import {
  createDefaultReviewLayout,
  LEGACY_REVIEW_LAYOUT_STORAGE_KEY,
  getNormalizedPaneSizes,
  getReviewLayoutStorageKey,
  REVIEW_LAYOUT_STORAGE_KEY_PREFIX,
  readStoredReviewLayout,
  reorderReviewPanes,
  setReviewPaneVisibility,
  type ReviewLayoutState,
  type ReviewPaneId
} from "@renderer/layout/review-layout";
import { createVimCursor, moveVimCursor, type VimCursor, type VimMotionKey } from "@renderer/lib/vim-motions";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPanel,
  MenuSeparator,
  MenuTrigger
} from "@renderer/components/ui/menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@renderer/components/ui/popover";
import { Toggle, ToggleGroup } from "@renderer/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@renderer/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle
} from "@renderer/components/ui/alert-dialog";
import { matchesKeybinding } from "@renderer/keybindings";
import { useAppStore } from "@renderer/store/app-store";
import { DEFAULT_KEYBINDINGS, type Keybinding } from "@shared/keybindings";
import type {
  AssistantProvider,
  CodexStatus,
  DiffLine,
  FileDiff,
  FileSearchResult,
  GitDraftAction,
  GitDraftResult,
  GitRunAction,
  GitWorkflowEvent,
  ThreadAnchor,
  ThreadPreview
} from "@shared/types";
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Files,
  FileDiff as FDiff,
  FolderInput,
  GitBranch,
  Github,
  GitCommitHorizontal,
  NotebookPen,
  Settings,
  X
} from "lucide-react";
import { PinList } from "./components/pin-list";

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
const DEFAULT_SIDEBAR_WIDTH = 248;
const DEFAULT_MIN_SIDEBAR_WIDTH = 235;
const MAX_SIDEBAR_WIDTH = 360;
const PROJECT_MENU_OFFSET = 6;
const MAX_RENDERED_DIFF_LINES = 1000;
const MIN_PANE_WIDTH = 180;
const FILE_SEARCH_LIMIT = 5;
const FILE_SEARCH_DEBOUNCE_MS = 120;
const SETTINGS_MENU_LABEL = "Settings";
const PROVIDER_TITLE = "Provider";
const FILE_SEARCH_SCOPE_TITLE = "File search scope";
const NO_SUPPORTED_EDITOR_ERROR = "No supported editor found. Install Visual Studio Code or Cursor.";
const CODEX_NOT_AVAILABLE_ERROR = "Codex CLI is unavailable. Install Codex CLI and confirm `codex app-server` works in your terminal.";
const OPENCODE_NOT_AVAILABLE_ERROR = "OpenCode CLI is unavailable. Install OpenCode CLI and confirm `opencode app-server` works in your terminal.";

const keybindingShortcutFallbacks: Record<string, string> = {
  "command-menu.open": "mod+/",
  "file-search.open": "/"
};

const keybindingCommandMap: Record<string, readonly string[]> = {
  "project-context.close": ["project-context.close"],
  "base-branch-menu.close": ["base-branch-menu.close"],
  "file.close": ["file.close"],
  "command-menu.open": ["command-menu.open"],
  "file-search.open": ["file-search.open"],
  "command-menu.close-or-back": ["command-menu.close-or-back"],
  "command-menu.next": ["command-menu.next"],
  "command-menu.previous": ["command-menu.previous"],
  "command-menu.select": ["command-menu.select"],
  "file-search.close": ["file-search.close"],
  "file-search.next": ["file-search.next"],
  "file-search.previous": ["file-search.previous"],
  "file-search.select": ["file-search.select"]
};

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
    userSettings,
    activeSession,
    files,
    selectedFileId,
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
    togglePinProject,
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
    updateUserSettings,
    dismissComposer,
    clearError
  } = useAppStore();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
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
  const [keybindings, setKeybindings] = useState<Keybinding[]>(DEFAULT_KEYBINDINGS);
  const [isUnsupportedEditorDialogOpen, setUnsupportedEditorDialogOpen] = useState(false);
  const [gitActionsMenuWidth, setGitActionsMenuWidth] = useState(180);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [opencodeStatus, setOpencodeStatus] = useState<CodexStatus | null>(null);
  const [assistantProvider, setAssistantProvider] = useState<AssistantProvider>("codex");
  const [gitActionLoading, setGitActionLoading] = useState<GitDraftAction | GitRunAction | null>(null);
  const [draftResult, setDraftResult] = useState<GitDraftResult | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const [workflowNotifications, setWorkflowNotifications] = useState<WorkflowNotification[]>([]);
  const gitActionsControlRef = useRef<HTMLDivElement | null>(null);
  const sidebarHeaderRef = useRef<HTMLDivElement | null>(null);
  const sidebarTitleRef = useRef<HTMLDivElement | null>(null);
  const sidebarAddRepoButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandMenuInputRef = useRef<HTMLInputElement | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reviewLayoutRef = useRef<HTMLDivElement | null>(null);
  const fileById = useMemo(() => Object.fromEntries(files.map((file) => [file.id, file])), [files]);
  const selectedFile = selectedFileId ? fileById[selectedFileId] ?? null : null;
  const deferredFileId = useDeferredValue(selectedFileId);
  const activeDiff = deferredFileId ? diffsByFile[deferredFileId] ?? null : null;
  const activeThreadPreviews = selectedFileId ? threadPreviewsByFile[selectedFileId] ?? [] : [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeAssistantStatus = assistantProvider === "opencode" ? opencodeStatus : codexStatus;
  const activeAssistantLabel = assistantProvider === "opencode" ? "OpenCode" : "Codex";
  const activeAssistantUnavailableMessage = assistantProvider === "opencode" ? OPENCODE_NOT_AVAILABLE_ERROR : CODEX_NOT_AVAILABLE_ERROR;
  const activeAssistantVersionLabel = assistantProvider === "opencode"
    ? (opencodeStatus?.version ? `OpenCode ${opencodeStatus.version}` : "OpenCode CLI")
    : (codexStatus?.version ? `Codex ${codexStatus.version}` : "Codex CLI");
  const hasUncommittedChanges = activeSession?.dirty ?? false;
  const canPushBranch = (activeProject?.aheadCount ?? 0) > 0;
  const gitPrimaryLabel = hasUncommittedChanges ? "Commit" : (canPushBranch ? "Push" : "Up to Date");
  const canRunPush = hasUncommittedChanges || canPushBranch;
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
  const shortcutByCommand = useMemo(() => buildShortcutByCommand(keybindings), [keybindings]);
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
        shortcut: shortcutByCommand.get("file-search.open") ?? keybindingShortcutFallbacks["file-search.open"],
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
    [activeProject, addProject, shortcutByCommand]
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
    const offUserSettingsChanged = window.codeWatch.events.onUserSettingsChanged((payload) => {
      useAppStore.setState({ userSettings: payload });
    });
    const offGitWorkflow = window.codeWatch.events.onGitWorkflowProgress((payload) => {
      setWorkflowNotifications((previous) => upsertWorkflowNotification(previous, payload));
    });

    return () => {
      offRepoChanged();
      offBranchChanged();
      offDirtyChanged();
      offSessionCreated();
      offUserSettingsChanged();
      offGitWorkflow();
    };
  }, [initialize, refreshProject]);

  useEffect(() => {
    let cancelled = false;
    void window.codeWatch.settings
      .loadKeybindings()
      .then((bindings) => {
        if (!cancelled) {
          setKeybindings(bindings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setUiError(error, "Failed to load keybindings.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.codeWatch.settings
      .loadAssistantSettings()
      .then((settings) => {
        if (!cancelled) {
          setAssistantProvider(settings.provider);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setUiError(error, "Failed to load assistant settings.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.codeWatch.assistants.codexStatus()
      .then((status) => {
        if (!cancelled) {
          setCodexStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCodexStatus({
            available: false,
            version: null,
            reason: error instanceof Error ? error.message : CODEX_NOT_AVAILABLE_ERROR
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.codeWatch.assistants.opencodeStatus()
      .then((status) => {
        if (!cancelled) {
          setOpencodeStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setOpencodeStatus({
            available: false,
            version: null,
            reason: error instanceof Error ? error.message : OPENCODE_NOT_AVAILABLE_ERROR
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  useLayoutEffect(() => {
    const gitActionsControl = gitActionsControlRef.current;
    if (!gitActionsControl) {
      return;
    }

    const measureWidth = () => {
      setGitActionsMenuWidth(Math.ceil(gitActionsControl.scrollWidth));
    };

    measureWidth();

    const resizeObserver = new ResizeObserver(measureWidth);
    resizeObserver.observe(gitActionsControl);
    window.addEventListener("resize", measureWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureWidth);
    };
  }, [gitPrimaryLabel]);

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
      if (matchesCommand(event, keybindings, "project-context.close")) {
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
  }, [keybindings]);

  useEffect(() => {
    setBaseBranchMenuOpen(false);
    setLoadingBaseBranches(false);
  }, [activeProjectId]);

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
  }, [isFileSearchOpen, fileSearchQuery, searchFiles, userSettings.fileSearchDepth, activeProjectId]);

  useEffect(() => {
    const handleGlobalFileSearchKeys = (event: KeyboardEvent) => {
      if (matchesCommand(event, keybindings, "file.close")) {
        event.preventDefault();
        const { selectedFileId, closeFile: closeFileAction } = useAppStore.getState();
        if (selectedFileId) {
          void closeFileAction(selectedFileId);
        }
        return;
      }

      if (matchesCommand(event, keybindings, "command-menu.open")) {
        event.preventDefault();
        openCommandMenu();
        return;
      }

      if (
        matchesCommand(event, keybindings, "file-search.open") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        openFileSearch();
        return;
      }

      if (isCommandMenuOpen) {
        if (matchesCommand(event, keybindings, "command-menu.close-or-back")) {
          event.preventDefault();
          if (commandMenuView.type === "root") {
            closeCommandMenu();
          } else {
            showCommandMenuRoot();
          }
          return;
        }

        if (matchesCommand(event, keybindings, "command-menu.next")) {
          event.preventDefault();
          setCommandMenuSelectedIndex((index) => clamp(index + 1, 0, Math.max(0, visibleCommandMenuItems.length - 1)));
          return;
        }

        if (matchesCommand(event, keybindings, "command-menu.previous")) {
          event.preventDefault();
          setCommandMenuSelectedIndex((index) => clamp(index - 1, 0, Math.max(0, visibleCommandMenuItems.length - 1)));
          return;
        }

        if (matchesCommand(event, keybindings, "command-menu.select")) {
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

      if (matchesCommand(event, keybindings, "file-search.close")) {
        event.preventDefault();
        setFileSearchOpen(false);
        return;
      }

      if (matchesCommand(event, keybindings, "file-search.next")) {
        event.preventDefault();
        setFileSearchSelectedIndex((index) => clamp(index + 1, 0, Math.max(0, fileSearchResults.length - 1)));
        return;
      }

      if (matchesCommand(event, keybindings, "file-search.previous")) {
        event.preventDefault();
        setFileSearchSelectedIndex((index) => clamp(index - 1, 0, Math.max(0, fileSearchResults.length - 1)));
        return;
      }

      if (matchesCommand(event, keybindings, "file-search.select")) {
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
    keybindings,
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
    const hydratedState = useAppStore.getState();
    const matchedFile =
      hydratedState.files.find((file) => file.filePath === result.filePath && file.source === "committed")
      ?? hydratedState.files.find((file) => file.filePath === result.filePath)
      ?? null;
    if (matchedFile) {
      await selectFile(matchedFile.id);
    }
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

  async function editKeybindings() {
    try {
      await window.codeWatch.settings.openKeybindingsInEditor();
      const nextKeybindings = await window.codeWatch.settings.loadKeybindings();
      setKeybindings(nextKeybindings);
      clearError();
    } catch (error) {
      if (isNoSupportedEditorError(error)) {
        setUnsupportedEditorDialogOpen(true);
        clearError();
        return;
      }
      setUiError(error, "Failed to open keybindings in a supported editor.");
    }
  }

  async function editUserSettings() {
    try {
      await window.codeWatch.settings.openUserSettingsInEditor();
      const nextUserSettings = await window.codeWatch.settings.loadUserSettings();
      useAppStore.setState({ userSettings: nextUserSettings });
      clearError();
    } catch (error) {
      if (isNoSupportedEditorError(error)) {
        setUnsupportedEditorDialogOpen(true);
        clearError();
        return;
      }
      setUiError(error, "Failed to open settings in a supported editor.");
    }
  }

  async function resetSettings() {
    try {
      await window.codeWatch.settings.reset();

      const keysToRemove: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key) {
          continue;
        }

        if (key === LEGACY_REVIEW_LAYOUT_STORAGE_KEY || key.startsWith(`${REVIEW_LAYOUT_STORAGE_KEY_PREFIX}.`)) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        window.localStorage.removeItem(key);
      }

      window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
      setReviewLayout(createDefaultReviewLayout());
      setLayoutProjectId(activeProjectId);

      const nextKeybindings = await window.codeWatch.settings.loadKeybindings();
      const nextUserSettings = await window.codeWatch.settings.loadUserSettings();
      setKeybindings(nextKeybindings);
      useAppStore.setState({ userSettings: nextUserSettings });
      clearError();
    } catch (error) {
      setUiError(error, "Failed to reset settings.");
    }
  }

  function handleFileSearchDepthChange(nextValues: string[]) {
    const nextDepth = nextValues[0];
    if (nextDepth === "global" || nextDepth === "project") {
      void updateUserSettings({ fileSearchDepth: nextDepth }).catch((error) => {
        setUiError(error, "Failed to save file search scope.");
      });
    }
  }

  function handleProviderChange(nextValues: string[]) {
    const nextProvider = nextValues[0];
    if (nextProvider === "codex" || nextProvider === "opencode") {
      setAssistantProvider(nextProvider);
      void window.codeWatch.settings.saveAssistantProvider(nextProvider).catch((error) => {
        setUiError(error, "Failed to save assistant provider.");
      });
    }
  }

  function setUiError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    useAppStore.setState({ error: message });
  }

  async function runGitPrimaryAction() {
    if (!hasUncommittedChanges && !canPushBranch) {
      return;
    }

    await runGitAction(hasUncommittedChanges ? "commit" : "push");
  }

  async function runGitAction(action: GitRunAction) {
    if (!activeSession) {
      return;
    }

    if (!activeAssistantStatus?.available) {
      setUiError(new Error(activeAssistantStatus?.reason ?? activeAssistantUnavailableMessage), activeAssistantUnavailableMessage);
      return;
    }

    setGitActionLoading(action);
    try {
      await window.codeWatch.assistants.runGitActionWithProvider(activeSession.session.id, assistantProvider, action);
      setDraftDialogOpen(false);
      setDraftResult(null);
      await refreshProject(activeSession.project.id);
    } catch (error) {
      setUiError(error, `Failed to ${action}.`);
    } finally {
      setGitActionLoading(null);
    }
  }

  async function runGitDraftAction(action: GitDraftAction) {
    if (!activeSession) {
      return;
    }

    if (!activeAssistantStatus?.available) {
      setUiError(new Error(activeAssistantStatus?.reason ?? activeAssistantUnavailableMessage), activeAssistantUnavailableMessage);
      return;
    }

    setGitActionLoading(action);
    try {
      const result = await window.codeWatch.assistants.draftGitArtifactsWithProvider(activeSession.session.id, assistantProvider, action);
      setDraftResult(result);
      setDraftDialogOpen(true);
      clearError();
    } catch (error) {
      setUiError(error, `Failed to draft with ${activeAssistantLabel}.`);
    } finally {
      setGitActionLoading(null);
    }
  }

  async function copyDraftText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      setUiError(error, "Failed to copy draft to the clipboard.");
    }
  }

  function dismissWorkflowNotification(id: string) {
    setWorkflowNotifications((previous) => previous.filter((notification) => notification.id !== id));
  }

  function openWorkflowUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
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

  const handleBaseBranchMenuOpenChange = (isOpen: boolean) => {
    setBaseBranchMenuOpen(isOpen);

    if (isOpen && activeProject) {
      setLoadingBaseBranches(true);
      void listBranches(activeProject.id).finally(() => {
        setLoadingBaseBranches(false);
      });
    }
  };

  const selectBaseBranch = (branch: string) => {
    if (!activeProject) {
      return;
    }

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
            <FileList files={files} selectedFileId={selectedFileId} onSelect={selectFile} />
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
                openFiles.map((fileId) => {
                  const file = fileById[fileId];
                  if (!file) {
                    return null;
                  }
                  const isActive = fileId === selectedFileId;
                  return (
                    <div
                      key={fileId}
                      className={`diff-tab ${isActive ? "diff-tab-active" : ""} ${draggedTab === fileId ? "diff-tab-dragging" : ""
                        } ${dropTargetTab === fileId && draggedTab !== fileId ? "diff-tab-drop-target" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("application/vnd.code-watch.tab", fileId);
                        setDraggedTab(fileId);
                        setDropTargetTab(fileId);
                      }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("application/vnd.code-watch.tab")) {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dropTargetTab !== fileId) setDropTargetTab(fileId);
                        }
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const draggedFileId = e.dataTransfer.getData("application/vnd.code-watch.tab");
                        if (draggedFileId && draggedFileId !== fileId) {
                          const newOpenFiles = reorderIdList(openFiles, draggedFileId, fileId);
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
                          void selectFile(fileId);
                        }
                      }}
                    >
                      <span className="diff-tab-label">
                        {(file.filePath.split("/").pop() || file.filePath)}
                        {file.source === "working-tree" ? " *" : ""}
                      </span>
                      <button
                        className="diff-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void closeFile(fileId);
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
              threadingEnabled={selectedFile?.source === "committed"}
              onCreateThread={(anchor) => beginThread(anchor)}
              onSelectThread={(threadId) => void selectThread(threadId)}
            />
          ) : selectedFileId ? (
            <LoadingState label="Loading diff" />
          ) : (
            <EmptyState title="No files" body="No committed or working-tree changes." />
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
          filePath={selectedFile?.filePath ?? null}
          threadEnabled={selectedFile?.source === "committed"}
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
    <SidebarProvider>
      <div className="app-shell" style={shellStyle}>
        <Sidebar>
          <SidebarHeader ref={sidebarHeaderRef}>
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
          </SidebarHeader>

          <SidebarContent className="sidebar-scroll">
            {projects.length === 0 ? (
              <EmptyState title="No repos" body="Add a local Git repo." actionLabel="+" onAction={() => void addProject()} />
            ) : (
              <PinList
                items={projects}
                itemKey={(p) => p.id}
                isPinned={(p) => p.isPinned}
                onTogglePin={(p) => void togglePinProject(p.id)}
                labels={{ pinned: "Pinned", unpinned: "Repositories" }}
                renderItem={(project) => {
                  const isActive = project.id === activeProjectId;

                  return (
                    <button
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
                }}
              />
            )}
          </SidebarContent>

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

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <Menu>
                  <MenuTrigger type="button" className="project-button project-row sidebar-settings-button" aria-label={SETTINGS_MENU_LABEL}>
                    <div className="project-copy">
                      <Settings className="project-icon" />
                      <strong>{SETTINGS_MENU_LABEL}</strong>
                    </div>
                  </MenuTrigger>
                  <MenuPanel sideOffset={8}>
                    <Popover>
                      <PopoverTrigger
                        type="button"
                        className="cw-menu-item sidebar-provider-menu-trigger"
                        aria-label="Choose assistant provider"
                        openOnHover
                        delay={100}
                        closeDelay={80}
                      >
                        <span>{PROVIDER_TITLE}</span>
                        <ChevronRight className="sidebar-provider-menu-icon" />
                      </PopoverTrigger>
                      <PopoverContent side="right" align="start" sideOffset={12} alignOffset={-6}>
                        <div className="sidebar-settings-popover" role="group" aria-label="Assistant provider settings">
                          <div className="sidebar-provider-popover-layout">
                            <p className="sidebar-settings-popover-title">{PROVIDER_TITLE}</p>
                            <ToggleGroup
                              orientation="vertical"
                              className="sidebar-provider-toggle-group"
                              value={[assistantProvider]}
                              onValueChange={handleProviderChange}
                            >
                              <Toggle value="codex" className="sidebar-provider-toggle">Codex</Toggle>
                              <Toggle value="opencode" className="sidebar-provider-toggle">OpenCode</Toggle>
                            </ToggleGroup>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuItem onClick={() => void editKeybindings()}>
                        <span>Edit keybindings</span>
                      </MenuItem>
                      <MenuItem onClick={() => void editUserSettings()}>
                        <span>Edit settings</span>
                      </MenuItem>
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuItem onClick={() => void resetSettings()}>
                        <span>Reset settings...</span>
                      </MenuItem>
                    </MenuGroup>
                  </MenuPanel>
                </Menu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

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
                <div ref={gitActionsControlRef} className="git-actions-control" role="group" aria-label="Git actions">
                  <button
                    type="button"
                    className="git-action-primary"
                    onClick={() => void runGitPrimaryAction()}
                    disabled={!hasUncommittedChanges && !canPushBranch}
                  >
                    {hasUncommittedChanges ? <GitCommitHorizontal className="git-action-icon" /> : <CloudUpload className="git-action-icon" />}
                    <span>{gitActionLoading === (hasUncommittedChanges ? "commit" : "push") ? (hasUncommittedChanges ? "Committing..." : "Pushing...") : gitPrimaryLabel}</span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      type="button"
                      className="git-action-trigger"
                      aria-label="Open git action menu"
                      disabled={!hasUncommittedChanges && !canPushBranch}
                    >
                      <ChevronDown className="git-action-chevron" />
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                      sideOffset={6}
                      align="end"
                      style={{ "--git-actions-width": `${gitActionsMenuWidth}px` } as CSSProperties}
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => void runGitAction("commit")}>
                          <span className="git-action-menu-item-main">
                            <GitCommitHorizontal className="git-action-menu-icon" />
                            <span>{gitActionLoading === "commit" ? "Committing..." : "Commit"}</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void runGitAction("push")} disabled={!canRunPush}>
                          <span className="git-action-menu-item-main">
                            <CloudUpload className="git-action-menu-icon" />
                            <span>{gitActionLoading === "push" ? "Pushing..." : "Push"}</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void runGitDraftAction("commit-and-pr")}>
                          <span className="git-action-menu-item-main">
                            <Github className="git-action-menu-icon" />
                            <span>{gitActionLoading === "commit-and-pr" ? "Drafting both..." : "Create PR"}</span>
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

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
                  <DropdownMenu open={isBaseBranchMenuOpen} onOpenChange={handleBaseBranchMenuOpenChange}>
                    <div className="base-branch-control" role="group" aria-label="Base branch">
                      <button
                        type="button"
                        className="base-branch-primary"
                        onClick={() => handleBaseBranchMenuOpenChange(!isBaseBranchMenuOpen)}
                      >
                        <GitBranch className="base-branch-icon" />
                        <span>{activeProject.defaultBaseBranch}</span>
                      </button>

                      <DropdownMenuTrigger
                        type="button"
                        className="base-branch-trigger"
                        aria-label="Open base branch menu"
                      >
                        <ChevronDown className="base-branch-chevron" />
                      </DropdownMenuTrigger>
                    </div>

                    <DropdownMenuContent
                      sideOffset={6}
                      align="end"
                    >
                      <DropdownMenuGroup>
                        {loadingBaseBranches ? (
                          <div className="base-branch-menu-state">Loading branches...</div>
                        ) : baseBranchOptions.length > 0 ? (
                          baseBranchOptions.map((branch) => (
                            <DropdownMenuItem key={branch} onClick={() => selectBaseBranch(branch)}>
                              <span className="base-branch-menu-item-main">
                                <GitBranch className="base-branch-menu-icon" />
                                <span>{branch}</span>
                              </span>
                              {branch === activeProject.defaultBaseBranch ? (
                                <span className="base-branch-menu-item-suffix">Current</span>
                              ) : null}
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <div className="base-branch-menu-state">No branches found.</div>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
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

        {draftDialogOpen && draftResult ? (
          <div className="draft-dialog-backdrop" role="presentation" onClick={() => setDraftDialogOpen(false)}>
            <div
              className="draft-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`${activeAssistantLabel} draft`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="draft-dialog-header">
                <div>
                  <h3>{activeAssistantLabel} Draft</h3>
                  <p>{activeAssistantVersionLabel} · Live working tree for commits, review session for PRs</p>
                </div>
                <button type="button" className="pane-toolbar-button" onClick={() => setDraftDialogOpen(false)} aria-label="Close draft dialog">
                  <X />
                </button>
              </div>

              {draftResult.warning ? <p className="draft-dialog-warning">{draftResult.warning}</p> : null}

              {draftResult.commit ? (() => {
                const commitDraft = draftResult.commit;
                return (
                  <section className="draft-document">
                    <div className="draft-document-header">
                      <h4>Commit message</h4>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void copyDraftText(joinDraftDocument(commitDraft.title, commitDraft.body))}
                      >
                        Copy
                      </button>
                    </div>
                    <textarea
                      className="draft-document-textarea"
                      readOnly
                      value={joinDraftDocument(commitDraft.title, commitDraft.body)}
                    />
                  </section>
                );
              })() : null}

              {draftResult.pr ? (() => {
                const prDraft = draftResult.pr;
                return (
                  <section className="draft-document">
                    <div className="draft-document-header">
                      <h4>Pull request</h4>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void copyDraftText(joinDraftDocument(prDraft.title, prDraft.body))}
                      >
                        Copy
                      </button>
                    </div>
                    <textarea
                      className="draft-document-textarea"
                      readOnly
                      value={joinDraftDocument(prDraft.title, prDraft.body)}
                    />
                  </section>
                );
              })() : null}
            </div>
          </div>
        ) : null}

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
                {command.shortcut ? <span className="command-palette-shortcut">{formatShortcut(command.shortcut)}</span> : null}
              </button>
            ))
          )}
        </CommandPaletteDialog>

        <CommandPaletteDialog
          open={isFileSearchOpen}
          label="Search files"
          value={fileSearchQuery}
          placeholder={userSettings.fileSearchDepth === "global" ? ("Search files across projects") : ("Search files with project scope")}
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

        <AlertDialog open={isUnsupportedEditorDialogOpen} onOpenChange={setUnsupportedEditorDialogOpen}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>No supported editor found</AlertDialogTitle>
              <AlertDialogDescription>
                Install Visual Studio Code or Cursor to edit settings files from Code Watch.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>

        {error ? (
          <div className="toast">
            <span>{error}</span>
            <button onClick={clearError}>Dismiss</button>
          </div>
        ) : null}

        <NotificationList
          notifications={workflowNotifications}
          onDismiss={dismissWorkflowNotification}
          onOpen={openWorkflowUrl}
        />
      </div>
    </SidebarProvider>
  );
}

function isNoSupportedEditorError(error: unknown): boolean {
  return error instanceof Error && error.message === NO_SUPPORTED_EDITOR_ERROR;
}

function DiffViewer({
  sessionId,
  diff,
  threadPreviews,
  threadingEnabled,
  onCreateThread,
  onSelectThread
}: {
  sessionId: string;
  diff: FileDiff;
  threadPreviews: ThreadPreview[];
  threadingEnabled: boolean;
  onCreateThread: (anchor: ThreadAnchor) => void;
  onSelectThread: (threadId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const { rows, isTruncated, renderedLineCount, totalLineCount } = useMemo(() => flattenDiffRows(diff), [diff]);
  const threadMap = useMemo(() => groupThreadsByLine(threadPreviews), [threadPreviews]);
  const navigableLines = useMemo(() => {
    const entries: Array<{ lineIndex: number; rowIndex: number; text: string }> = [];
    let lineIndex = 0;
    rows.forEach((row, rowIndex) => {
      if (row.type !== "line") {
        return;
      }
      entries.push({
        lineIndex,
        rowIndex,
        text: getDisplayLineText(row.line)
      });
      lineIndex += 1;
    });
    return entries;
  }, [rows]);
  const navigableLineByRowIndex = useMemo(
    () => new Map(navigableLines.map((entry) => [entry.rowIndex, entry])),
    [navigableLines]
  );
  const lineTexts = useMemo(() => navigableLines.map((entry) => entry.text), [navigableLines]);
  const [vimCursor, setVimCursor] = useState<VimCursor | null>(() =>
    lineTexts.length > 0 ? createVimCursor(lineTexts) : null
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "hunk" ? 36 : 28),
    overscan: 16
  });

  useEffect(() => {
    setVimCursor(lineTexts.length > 0 ? createVimCursor(lineTexts) : null);
  }, [lineTexts]);

  useEffect(() => {
    if (!vimCursor) {
      return;
    }

    const activeLine = navigableLines[vimCursor.lineIndex];
    if (!activeLine) {
      return;
    }

    rowVirtualizer.scrollToIndex(activeLine.rowIndex, { align: "auto" });
  }, [navigableLines, rowVirtualizer, vimCursor]);

  const handleDiffKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSupportedDiffMotionKey(event.nativeEvent) || isEditableTarget(event.target)) {
      return;
    }

    if (window.getSelection()?.type === "Range" || lineTexts.length === 0) {
      return;
    }

    const currentCursor = vimCursor ?? createVimCursor(lineTexts);
    const nextCursor = moveVimCursor(lineTexts, currentCursor, event.key as VimMotionKey);
    event.preventDefault();

    if (nextCursor.lineIndex === currentCursor.lineIndex && nextCursor.column === currentCursor.column) {
      return;
    }

    setVimCursor(nextCursor);
  };

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
      <div
        ref={parentRef}
        className="virtual-scroll diff-scroll"
        tabIndex={0}
        onKeyDown={handleDiffKeyDown}
        onMouseDownCapture={(event) => {
          event.currentTarget.focus();
        }}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", marginLeft: "-10px", marginRight: "10px" }}>
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
            const navigableLine = navigableLineByRowIndex.get(virtualRow.index) ?? null;
            const isActiveLine = navigableLine !== null && vimCursor?.lineIndex === navigableLine.lineIndex;
            const threads = threadMap.get(threadKey) ?? [];
            const firstThread = threads[0];
            const anchor = toAnchor(diff.filePath, row.line);
            const canThread = threadingEnabled && (row.line.oldLineNumber !== null || row.line.newLineNumber !== null);

            return (
              <button
                key={row.id}
                className={`diff-line diff-line-${row.line.kind} ${isActiveLine ? "diff-line-active" : ""}`}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                onClick={() => {
                  if (navigableLine) {
                    const maxColumn = Math.max(0, navigableLine.text.length - 1);
                    setVimCursor((currentCursor) => ({
                      lineIndex: navigableLine.lineIndex,
                      column: Math.min(currentCursor?.column ?? 0, maxColumn),
                      preferredColumn: Math.min(currentCursor?.preferredColumn ?? 0, maxColumn)
                    }));
                  }

                  if (canThread) {
                    onCreateThread({ ...anchor, sessionId });
                  }
                }}
              >
                <span className="line-number">{row.line.oldLineNumber ?? ""}</span>
                <span className="line-number">{row.line.newLineNumber ?? ""}</span>
                <code>{renderDiffLineText(getDisplayLineText(row.line), isActiveLine ? vimCursor?.column ?? 0 : null)}</code>
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

function getDisplayLineText(line: DiffLine): string {
  return `${line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}${line.text}`;
}

function renderDiffLineText(text: string, activeColumn: number | null) {
  if (activeColumn === null) {
    return text;
  }

  const safeColumn = clamp(activeColumn, 0, Math.max(0, text.length - 1));
  return (
    <>
      {text.slice(0, safeColumn)}
      <span className="vim-caret">{text[safeColumn] ?? " "}</span>
      {text.slice(safeColumn + 1)}
    </>
  );
}

function isSupportedDiffMotionKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  return event.key === "h"
    || event.key === "j"
    || event.key === "k"
    || event.key === "l"
    || event.key === "w"
    || event.key === "b"
    || event.key === "W"
    || event.key === "B"
    || event.key === "0"
    || event.key === "$"
    || event.key === "*";
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

function matchesCommand(event: KeyboardEvent, keybindings: readonly Keybinding[], command: string): boolean {
  const commands = keybindingCommandMap[command] ?? [command];
  return keybindings.some((binding) => commands.includes(binding.command) && matchesKeybinding(event, binding.key));
}

function buildShortcutByCommand(keybindings: readonly Keybinding[]): Map<string, string> {
  const shortcutByCommand = new Map<string, string>();
  for (const binding of keybindings) {
    if (!shortcutByCommand.has(binding.command)) {
      shortcutByCommand.set(binding.command, binding.key);
    }
  }
  return shortcutByCommand;
}

function formatShortcut(rawShortcut: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const tokens = rawShortcut
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (!isMac) {
    return tokens
      .map((token) => {
        if (token === "mod") {
          return "Ctrl";
        }
        if (token === "ctrl") {
          return "Ctrl";
        }
        if (token === "meta") {
          return "Meta";
        }
        if (token === "alt") {
          return "Alt";
        }
        if (token === "shift") {
          return "Shift";
        }
        return token.length === 1 ? token.toUpperCase() : token;
      })
      .join("+");
  }

  return tokens
    .map((token) => {
      if (token === "mod" || token === "meta") {
        return "⌘";
      }
      if (token === "ctrl") {
        return "⌃";
      }
      if (token === "alt") {
        return "⌥";
      }
      if (token === "shift") {
        return "⇧";
      }
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join("");
}

function joinDraftDocument(title: string, body: string): string {
  return body.trim().length > 0 ? `${title}\n\n${body}` : title;
}

function upsertWorkflowNotification(
  notifications: WorkflowNotification[],
  payload: GitWorkflowEvent
): WorkflowNotification[] {
  const existingIndex = notifications.findIndex((notification) => notification.id === payload.id);
  if (existingIndex === -1) {
    return [payload, ...notifications].slice(0, 4);
  }

  const next = [...notifications];
  next[existingIndex] = payload;
  return next;
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
