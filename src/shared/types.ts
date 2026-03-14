import { z } from "zod";
import { keybindingsSchema } from "@shared/keybindings";

export const threadStatusSchema = z.enum(["open", "resolved"]);
export const threadSideSchema = z.enum(["old", "new"]);
export const fileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "unmerged",
  "unknown"
]);
export const diffLineKindSchema = z.enum(["hunk", "context", "add", "delete", "meta"]);
export const changeSourceSchema = z.enum(["committed", "working-tree"]);

export const threadAnchorSchema = z.object({
  sessionId: z.string(),
  filePath: z.string(),
  side: threadSideSchema,
  oldLine: z.number().int().nullable(),
  newLine: z.number().int().nullable(),
  hunkHeader: z.string(),
  lineContentHash: z.string()
});

export const commentRecordSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
});

export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  repoPath: z.string(),
  defaultBaseBranch: z.string(),
  sortOrder: z.number().int(),
  isPinned: z.boolean(),
  createdAt: z.number().int(),
  lastOpenedAt: z.number().int(),
  currentBranch: z.string().nullable(),
  headSha: z.string().nullable(),
  dirty: z.boolean()
});

export const reviewSessionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  branchName: z.string(),
  baseBranch: z.string(),
  headSha: z.string(),
  baseSha: z.string(),
  mergeBaseSha: z.string(),
  createdAt: z.number().int(),
  lastOpenedAt: z.number().int()
});

export const changedFileSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  source: changeSourceSchema,
  filePath: z.string(),
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
  status: fileStatusSchema,
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  isBinary: z.boolean()
});

export const diffLineSchema = z.object({
  id: z.string(),
  kind: diffLineKindSchema,
  text: z.string(),
  oldLineNumber: z.number().int().nullable(),
  newLineNumber: z.number().int().nullable(),
  lineContentHash: z.string(),
  hunkHeader: z.string()
});

export const diffHunkSchema = z.object({
  id: z.string(),
  header: z.string(),
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(diffLineSchema)
});

export const fileDiffSchema = z.object({
  filePath: z.string(),
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
  isBinary: z.boolean(),
  stats: z.object({
    additions: z.number().int().nullable(),
    deletions: z.number().int().nullable()
  }),
  hunks: z.array(diffHunkSchema)
});

export const threadPreviewSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  filePath: z.string(),
  status: threadStatusSchema,
  anchor: threadAnchorSchema,
  latestComments: z.array(commentRecordSchema),
  remainingCommentCount: z.number().int(),
  commentCount: z.number().int(),
  createdAt: z.number().int(),
  resolvedAt: z.number().int().nullable()
});

export const paginatedCommentsSchema = z.object({
  threadId: z.string(),
  comments: z.array(commentRecordSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean()
});

export const reviewSessionDetailSchema = z.object({
  session: reviewSessionSummarySchema,
  project: projectSummarySchema,
  dirty: z.boolean()
});

export const reviewOpenResultSchema = z.object({
  created: z.boolean(),
  detail: reviewSessionDetailSchema
});

export const repoStateEventSchema = z.object({
  projectId: z.string(),
  branchName: z.string().nullable(),
  headSha: z.string().nullable(),
  dirty: z.boolean()
});

export const reviewSessionEventSchema = z.object({
  projectId: z.string(),
  sessionId: z.string()
});

export const fileSearchResultSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  sessionId: z.string(),
  filePath: z.string()
});

export const gitDraftActionSchema = z.enum(["commit", "pr", "commit-and-pr"]);
export const gitRunActionSchema = z.enum(["commit", "push"]);

const gitDraftDocumentSchema = z.object({
  title: z.string(),
  body: z.string()
});

export const gitDraftResultSchema = z.object({
  action: gitDraftActionSchema,
  commit: gitDraftDocumentSchema.nullable(),
  pr: gitDraftDocumentSchema.nullable(),
  warning: z.string().nullable()
});

export const codexStatusSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  reason: z.string().nullable()
});

export const gitRunResultSchema = z.object({
  action: gitRunActionSchema,
  committed: z.boolean(),
  pushed: z.boolean(),
  commitTitle: z.string().nullable(),
  summary: z.string(),
  prUrl: z.string().nullable()
});

export const gitWorkflowStageSchema = z.enum(["committing", "pushing", "creating-pr", "completed", "failed"]);

export const gitWorkflowEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  action: gitRunActionSchema,
  stage: gitWorkflowStageSchema,
  title: z.string(),
  message: z.string(),
  prUrl: z.string().nullable()
});

export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export type ThreadSide = z.infer<typeof threadSideSchema>;
export type FileStatus = z.infer<typeof fileStatusSchema>;
export type ChangeSource = z.infer<typeof changeSourceSchema>;
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;
export type CommentRecord = z.infer<typeof commentRecordSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ReviewSessionSummary = z.infer<typeof reviewSessionSummarySchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
export type DiffLine = z.infer<typeof diffLineSchema>;
export type DiffHunk = z.infer<typeof diffHunkSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type ThreadPreview = z.infer<typeof threadPreviewSchema>;
export type PaginatedComments = z.infer<typeof paginatedCommentsSchema>;
export type ReviewSessionDetail = z.infer<typeof reviewSessionDetailSchema>;
export type ReviewOpenResult = z.infer<typeof reviewOpenResultSchema>;
export type RepoStateEvent = z.infer<typeof repoStateEventSchema>;
export type ReviewSessionEvent = z.infer<typeof reviewSessionEventSchema>;
export type FileSearchResult = z.infer<typeof fileSearchResultSchema>;
export type GitDraftAction = z.infer<typeof gitDraftActionSchema>;
export type GitRunAction = z.infer<typeof gitRunActionSchema>;
export type GitDraftResult = z.infer<typeof gitDraftResultSchema>;
export type CodexStatus = z.infer<typeof codexStatusSchema>;
export type GitRunResult = z.infer<typeof gitRunResultSchema>;
export type GitWorkflowStage = z.infer<typeof gitWorkflowStageSchema>;
export type GitWorkflowEvent = z.infer<typeof gitWorkflowEventSchema>;

export const THREAD_PREVIEW_COMMENT_COUNT = 2;
export const THREAD_PAGE_SIZE = 20;

export interface CodeWatchApi {
  projects: {
    pickDirectory: () => Promise<string | null>;
    add: (repoPath: string) => Promise<ProjectSummary>;
    list: () => Promise<ProjectSummary[]>;
    reorder: (projectIds: string[]) => Promise<ProjectSummary[]>;
    remove: (projectId: string) => Promise<void>;
    togglePin: (projectId: string) => Promise<ProjectSummary>;
    listBranches: (projectId: string) => Promise<string[]>;
    updateBaseBranch: (projectId: string, baseBranch: string) => Promise<ProjectSummary>;
  };
  reviews: {
    open: (projectId: string, baseBranch?: string) => Promise<ReviewOpenResult>;
    list: (projectId: string) => Promise<ReviewSessionSummary[]>;
    load: (sessionId: string) => Promise<ReviewSessionDetail>;
    files: (sessionId: string) => Promise<ChangedFile[]>;
    diff: (sessionId: string, filePath: string, source?: ChangeSource) => Promise<FileDiff>;
  };
  threads: {
    listForFile: (sessionId: string, filePath: string) => Promise<ThreadPreview[]>;
    get: (threadId: string, cursor?: string) => Promise<PaginatedComments>;
    create: (anchor: ThreadAnchor, body: string) => Promise<ThreadPreview>;
    addComment: (threadId: string, body: string) => Promise<PaginatedComments>;
    resolve: (threadId: string) => Promise<ThreadPreview>;
    reopen: (threadId: string) => Promise<ThreadPreview>;
  };
  search: {
    files: (query: string, limit?: number) => Promise<FileSearchResult[]>;
  };
  settings: {
    loadKeybindings: () => Promise<z.infer<typeof keybindingsSchema>>;
    openKeybindingsInEditor: () => Promise<void>;
    reset: () => Promise<void>;
  };
  assistants: {
    codexStatus: () => Promise<CodexStatus>;
    draftGitArtifacts: (sessionId: string, action: GitDraftAction) => Promise<GitDraftResult>;
    runGitAction: (sessionId: string, action: GitRunAction) => Promise<GitRunResult>;
  };
  events: {
    onRepoChanged: (listener: (payload: RepoStateEvent) => void) => () => void;
    onBranchChanged: (listener: (payload: RepoStateEvent) => void) => () => void;
    onDirtyStateChanged: (listener: (payload: RepoStateEvent) => void) => () => void;
    onReviewSessionCreated: (listener: (payload: ReviewSessionEvent) => void) => () => void;
    onGitWorkflowProgress: (listener: (payload: GitWorkflowEvent) => void) => () => void;
  };
}
