import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@main/db/client";
import { commentsTable, threadsTable } from "@main/db/schema";
import { createId, now, parseCursor } from "@main/services/utils";
import {
  THREAD_PAGE_SIZE,
  THREAD_PREVIEW_COMMENT_COUNT,
  type PaginatedComments,
  type ThreadAnchor,
  type ThreadPreview
} from "@shared/types";

export class ThreadService {
  constructor(private readonly db: AppDatabase) {}

  async listForFile(sessionId: string, filePath: string): Promise<ThreadPreview[]> {
    const threads = await this.db.query.threadsTable.findMany({
      where: and(eq(threadsTable.sessionId, sessionId), eq(threadsTable.filePath, filePath)),
      orderBy: desc(threadsTable.createdAt)
    });

    return Promise.all(threads.map((thread) => this.buildPreview(thread.id)));
  }

  async get(threadId: string, cursor?: string): Promise<PaginatedComments> {
    const thread = await this.requireThread(threadId);
    const offset = parseCursor(cursor);
    const rows = await this.db.query.commentsTable.findMany({
      where: eq(commentsTable.threadId, threadId),
      orderBy: desc(commentsTable.createdAt),
      limit: THREAD_PAGE_SIZE,
      offset
    });

    const comments = rows
      .slice()
      .reverse()
      .map((comment) => ({
        id: comment.id,
        threadId: comment.threadId,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
      }));

    const nextOffset = offset + rows.length;
    return {
      threadId,
      comments,
      hasMore: nextOffset < thread.commentCount,
      nextCursor: nextOffset < thread.commentCount ? String(nextOffset) : null
    };
  }

  async create(anchor: ThreadAnchor, body: string): Promise<ThreadPreview> {
    const timestamp = now();
    const threadId = createId("thread");
    const commentId = createId("comment");

    this.db.transaction((tx) => {
      tx.insert(threadsTable).values({
        id: threadId,
        sessionId: anchor.sessionId,
        filePath: anchor.filePath,
        side: anchor.side,
        oldLine: anchor.oldLine,
        newLine: anchor.newLine,
        hunkHeader: anchor.hunkHeader,
        lineContentHash: anchor.lineContentHash,
        status: "open",
        commentCount: 1,
        createdAt: timestamp,
        resolvedAt: null
      }).run();

      tx.insert(commentsTable).values({
        id: commentId,
        threadId,
        body,
        createdAt: timestamp,
        updatedAt: timestamp
      }).run();
    });

    return this.buildPreview(threadId);
  }

  async addComment(threadId: string, body: string): Promise<PaginatedComments> {
    await this.requireThread(threadId);
    const timestamp = now();

    this.db.transaction((tx) => {
      tx.insert(commentsTable).values({
        id: createId("comment"),
        threadId,
        body,
        createdAt: timestamp,
        updatedAt: timestamp
      }).run();

      tx
        .update(threadsTable)
        .set({
          commentCount: sql`${threadsTable.commentCount} + 1`
        })
        .where(eq(threadsTable.id, threadId))
        .run();
    });

    return this.get(threadId);
  }

  async resolve(threadId: string): Promise<ThreadPreview> {
    await this.requireThread(threadId);
    this.db
      .update(threadsTable)
      .set({
        status: "resolved",
        resolvedAt: now()
      })
      .where(eq(threadsTable.id, threadId))
      .run();

    return this.buildPreview(threadId);
  }

  async reopen(threadId: string): Promise<ThreadPreview> {
    await this.requireThread(threadId);
    this.db
      .update(threadsTable)
      .set({
        status: "open",
        resolvedAt: null
      })
      .where(eq(threadsTable.id, threadId))
      .run();

    return this.buildPreview(threadId);
  }

  private async buildPreview(threadId: string): Promise<ThreadPreview> {
    const thread = await this.requireThread(threadId);
    const latestComments = await this.db.query.commentsTable.findMany({
      where: eq(commentsTable.threadId, threadId),
      orderBy: desc(commentsTable.createdAt),
      limit: THREAD_PREVIEW_COMMENT_COUNT
    });

    return {
      id: thread.id,
      sessionId: thread.sessionId,
      filePath: thread.filePath,
      status: thread.status as ThreadPreview["status"],
      anchor: {
        sessionId: thread.sessionId,
        filePath: thread.filePath,
        side: thread.side as ThreadPreview["anchor"]["side"],
        oldLine: thread.oldLine,
        newLine: thread.newLine,
        hunkHeader: thread.hunkHeader,
        lineContentHash: thread.lineContentHash
      },
      latestComments: latestComments
        .slice()
        .reverse()
        .map((comment) => ({
          id: comment.id,
          threadId: comment.threadId,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt
        })),
      remainingCommentCount: Math.max(0, thread.commentCount - latestComments.length),
      commentCount: thread.commentCount,
      createdAt: thread.createdAt,
      resolvedAt: thread.resolvedAt
    };
  }

  private async requireThread(threadId: string) {
    const thread = await this.db.query.threadsTable.findFirst({
      where: eq(threadsTable.id, threadId)
    });

    if (!thread) {
      throw new Error("Thread not found.");
    }

    return thread;
  }
}
