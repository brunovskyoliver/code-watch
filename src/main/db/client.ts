import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import * as schema from "@main/db/schema";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL UNIQUE,
      default_base_branch TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      branch_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      merge_base_sha TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_files (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      old_path TEXT,
      new_path TEXT,
      status TEXT NOT NULL,
      additions INTEGER,
      deletions INTEGER,
      is_binary INTEGER NOT NULL DEFAULT 0,
      sort_key INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      side TEXT NOT NULL,
      old_line INTEGER,
      new_line INTEGER,
      hunk_header TEXT NOT NULL,
      line_content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      comment_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const hasSortOrder = sqlite
    .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'sort_order' LIMIT 1")
    .get();

  if (!hasSortOrder) {
    sqlite.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;");
  }

  sqlite.exec(`
    UPDATE projects
    SET sort_order = ranked.row_num
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY last_opened_at DESC, created_at DESC, id ASC) AS row_num
      FROM projects
    ) AS ranked
    WHERE projects.id = ranked.id
      AND IFNULL(projects.sort_order, 0) = 0;
  `);
}

export function createDatabase() {
  const dbPath = path.join(app.getPath("userData"), "code-watch.db");
  const sqlite = new Database(dbPath);
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });

  return { db, sqlite, dbPath };
}
