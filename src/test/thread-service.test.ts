import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import * as schema from "@main/db/schema";
import { ThreadService } from "@main/services/threads";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL UNIQUE,
      default_base_branch TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );

    CREATE TABLE review_sessions (
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

    CREATE TABLE threads (
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

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const db = drizzle(sqlite, { schema });
  db.insert(schema.projectsTable).values({
    id: "project_1",
    name: "demo",
    repoPath: "/tmp/demo",
    defaultBaseBranch: "main",
    createdAt: 1,
    lastOpenedAt: 1
  }).run();

  db.insert(schema.reviewSessionsTable).values({
    id: "session_1",
    projectId: "project_1",
    branchName: "feature/demo",
    baseBranch: "main",
    headSha: "abc1234",
    baseSha: "def5678",
    mergeBaseSha: "9999999",
    createdAt: 1,
    lastOpenedAt: 1
  }).run();

  return { db, sqlite };
}

describe("ThreadService", () => {
  it("returns collapsed previews and paginates older comments", async () => {
    const { db, sqlite } = createTestDatabase();
    const service = new ThreadService(db);

    db.insert(schema.threadsTable).values({
      id: "thread_1",
      sessionId: "session_1",
      filePath: "src/app.ts",
      side: "new",
      oldLine: null,
      newLine: 42,
      hunkHeader: "@@ -40,2 +42,8 @@",
      lineContentHash: "hash-1",
      status: "open",
      commentCount: 25,
      createdAt: 1,
      resolvedAt: null
    }).run();

    db.insert(schema.commentsTable).values(
      Array.from({ length: 25 }, (_, index) => ({
        id: `comment_${index + 1}`,
        threadId: "thread_1",
        body: `Comment ${index + 1}`,
        createdAt: index + 1,
        updatedAt: index + 1
      }))
    ).run();

    const previews = await service.listForFile("session_1", "src/app.ts");
    expect(previews).toHaveLength(1);
    expect(previews[0]?.latestComments.map((comment) => comment.body)).toEqual(["Comment 24", "Comment 25"]);
    expect(previews[0]?.remainingCommentCount).toBe(23);

    const pageOne = await service.get("thread_1");
    expect(pageOne.comments).toHaveLength(20);
    expect(pageOne.comments[0]?.body).toBe("Comment 6");
    expect(pageOne.comments.at(-1)?.body).toBe("Comment 25");
    expect(pageOne.hasMore).toBe(true);

    const pageTwo = await service.get("thread_1", pageOne.nextCursor ?? undefined);
    expect(pageTwo.comments.map((comment) => comment.body)).toEqual([
      "Comment 1",
      "Comment 2",
      "Comment 3",
      "Comment 4",
      "Comment 5"
    ]);
    expect(pageTwo.hasMore).toBe(false);

    sqlite.close();
  });
});
