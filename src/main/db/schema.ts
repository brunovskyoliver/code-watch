import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectsTable = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull().unique(),
  defaultBaseBranch: text("default_base_branch").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  lastOpenedAt: integer("last_opened_at").notNull()
});

export const reviewSessionsTable = sqliteTable("review_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  branchName: text("branch_name").notNull(),
  baseBranch: text("base_branch").notNull(),
  headSha: text("head_sha").notNull(),
  baseSha: text("base_sha").notNull(),
  mergeBaseSha: text("merge_base_sha").notNull(),
  createdAt: integer("created_at").notNull(),
  lastOpenedAt: integer("last_opened_at").notNull()
});

export const sessionFilesTable = sqliteTable("session_files", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => reviewSessionsTable.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  oldPath: text("old_path"),
  newPath: text("new_path"),
  status: text("status").notNull(),
  additions: integer("additions"),
  deletions: integer("deletions"),
  isBinary: integer("is_binary", { mode: "boolean" }).notNull().default(false),
  sortKey: integer("sort_key").notNull()
});

export const threadsTable = sqliteTable("threads", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => reviewSessionsTable.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  side: text("side").notNull(),
  oldLine: integer("old_line"),
  newLine: integer("new_line"),
  hunkHeader: text("hunk_header").notNull(),
  lineContentHash: text("line_content_hash").notNull(),
  status: text("status").notNull(),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at")
});

export const commentsTable = sqliteTable("comments", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threadsTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const settingsTable = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});
