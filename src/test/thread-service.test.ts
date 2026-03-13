import { describe, expect, it } from "vitest";
import { commentsTable, threadsTable } from "@main/db/schema";
import { ThreadService } from "@main/services/threads";

function createFakeDb() {
  const threads: Array<{
    id: string;
    sessionId: string;
    filePath: string;
    side: string;
    oldLine: number | null;
    newLine: number | null;
    hunkHeader: string;
    lineContentHash: string;
    status: string;
    commentCount: number;
    createdAt: number;
    resolvedAt: number | null;
  }> = [
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

  return {
    query: {
      threadsTable: {
        findMany: async () => [...threads],
        findFirst: async () => threads[0] ?? null
      },
      commentsTable: {
        findMany: async ({ limit, offset = 0 }: { limit?: number; offset?: number } = {}) =>
          [...comments]
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(offset, limit ? offset + limit : undefined)
      }
    },
    transaction<T>(callback: (tx: {
      insert: (table: unknown) => {
        values: (values: Record<string, unknown>) => { run: () => void };
      };
      update: (table: unknown) => {
        set: (values: Record<string, unknown>) => {
          where: (_where: unknown) => { run: () => void };
        };
      };
    }) => T): T {
      return callback({
        insert(table: unknown) {
          return {
            values(values: Record<string, unknown>) {
              return {
                run() {
                  if (table === threadsTable) {
                    threads.push(values as typeof threads[number]);
                  }

                  if (table === commentsTable) {
                    comments.push(values as typeof comments[number]);
                  }
                }
              };
            }
          };
        },
        update(_table: unknown) {
          return {
            set(values: Record<string, unknown>) {
              return {
                where(_where: unknown) {
                  return {
                    run() {
                      if (threads[0]) {
                        Object.assign(threads[0], values);
                      }
                    }
                  };
                }
              };
            }
          };
        }
      });
    },
    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(_where: unknown) {
              return {
                run() {
                  if (threads[0]) {
                    Object.assign(threads[0], values);
                  }
                }
              };
            }
          };
        }
      };
    }
  };
}

describe("ThreadService", () => {
  it("returns collapsed previews and paginates older comments", async () => {
    const db = createFakeDb();
    const service = new ThreadService(db as never);

    const previews = await service.listForFile("session_1", "src/app.ts");
    expect(previews).toHaveLength(1);
    expect(previews[0]?.latestComments.map((comment) => comment.body)).toEqual(["Comment 24", "Comment 25"]);
    expect(previews[0]?.remainingCommentCount).toBe(23);
    expect(previews[0]?.lastActivityAt).toBe(25);

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
