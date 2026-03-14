import { describe, expect, it } from "vitest";
import { ThreadService } from "@main/services/threads";

function createTestDatabase() {
  const threads = [
    {
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
    }
  ];

  const comments = Array.from({ length: 25 }, (_, index) => ({
    id: `comment_${index + 1}`,
    threadId: "thread_1",
    body: `Comment ${index + 1}`,
    createdAt: index + 1,
    updatedAt: index + 1
  }));

  const db = {
    query: {
      threadsTable: {
        findMany: async () => threads.slice().sort((left, right) => right.createdAt - left.createdAt),
        findFirst: async () => threads[0] ?? null
      },
      commentsTable: {
        findMany: async ({ limit, offset }: { limit?: number; offset?: number } = {}) =>
          comments
            .slice()
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(offset ?? 0, (offset ?? 0) + (limit ?? comments.length))
      }
    }
  };

  return { db: db as any };
}

describe("ThreadService", () => {
  it("returns collapsed previews and paginates older comments", async () => {
    const { db } = createTestDatabase();
    const service = new ThreadService(db);

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
  });
});
