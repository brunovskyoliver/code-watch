import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EmptyState, LoadingState } from "@renderer/components/shared";
import type { PaginatedComments, ThreadAnchor, ThreadPreview } from "@shared/types";

type ThreadListItem =
  | { type: "thread"; id: string; thread: ThreadPreview }
  | { type: "resolved-toggle"; id: string; count: number };

export function ThreadPanel({
  filePath,
  threadPreviews,
  activeThread,
  activeThreadPreview,
  composerAnchor,
  loadingThread,
  onSelectThread,
  onLoadOlder,
  onCreateThread,
  onAddComment,
  onResolve,
  onReopen,
  onCancelComposer
}: {
  filePath: string | null;
  threadPreviews: ThreadPreview[];
  activeThread: PaginatedComments | null;
  activeThreadPreview: ThreadPreview | null;
  composerAnchor: ThreadAnchor | null;
  loadingThread: boolean;
  onSelectThread: (threadId: string) => Promise<void> | void;
  onLoadOlder: () => Promise<void> | void;
  onCreateThread: (body: string) => Promise<void> | void;
  onAddComment: (body: string) => Promise<void> | void;
  onResolve: () => Promise<void> | void;
  onReopen: () => Promise<void> | void;
  onCancelComposer: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openThreads = useMemo(() => threadPreviews.filter((thread) => thread.status === "open"), [threadPreviews]);
  const resolvedThreads = useMemo(() => threadPreviews.filter((thread) => thread.status === "resolved"), [threadPreviews]);
  const items = useMemo<ThreadListItem[]>(() => {
    const nextItems: ThreadListItem[] = openThreads.map((thread) => ({
      type: "thread",
      id: thread.id,
      thread
    }));

    if (resolvedThreads.length > 0) {
      nextItems.push({
        type: "resolved-toggle",
        id: "resolved-toggle",
        count: resolvedThreads.length
      });
    }

    if (showResolved) {
      nextItems.push(
        ...resolvedThreads.map((thread) => ({
          type: "thread" as const,
          id: thread.id,
          thread
        }))
      );
    }

    return nextItems;
  }, [openThreads, resolvedThreads, showResolved]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (items[index]?.type === "resolved-toggle" ? 52 : 92),
    overscan: 8
  });

  useEffect(() => {
    setDraft("");
  }, [composerAnchor?.lineContentHash, activeThread?.threadId]);

  useEffect(() => {
    if (activeThreadPreview?.status === "resolved") {
      setShowResolved(true);
    }
  }, [activeThreadPreview?.id, activeThreadPreview?.status]);

  const submit = async () => {
    const value = draft.trim();
    if (!value) {
      return;
    }

    if (composerAnchor) {
      await onCreateThread(value);
    } else {
      await onAddComment(value);
    }
    setDraft("");
  };

  return (
    <Fragment>
      <div className="pane-header">
        <h3>Notes</h3>
        <span>{threadPreviews.length}</span>
      </div>

      {!filePath ? (
        <EmptyState title="Select a file" body="Thread previews appear once a changed file is selected." />
      ) : (
        <div className="thread-layout">
          <div ref={listRef} className="virtual-scroll thread-list-scroll">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) {
                  return null;
                }

                if (item.type === "resolved-toggle") {
                  return (
                    <button
                      key={item.id}
                      className="resolved-toggle"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                      onClick={() => setShowResolved((value) => !value)}
                    >
                      {showResolved ? "Hide" : "Show"} resolved ({item.count})
                    </button>
                  );
                }

                const thread = item.thread;
                const latestComment = thread.latestComments.at(-1);
                const active = activeThreadPreview?.id === thread.id;
                return (
                  <button
                    key={thread.id}
                    className={`thread-preview ${active ? "thread-preview-active" : ""}`}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                    onClick={() => void onSelectThread(thread.id)}
                  >
                    <div className="thread-preview-head">
                      <span>Line {thread.anchor.newLine ?? thread.anchor.oldLine ?? "?"}</span>
                      <span className={`status-pill status-pill-${thread.status}`}>{thread.status}</span>
                    </div>
                    <p>{latestComment?.body ?? "No comments"}</p>
                    <div className="thread-preview-foot">
                      {thread.remainingCommentCount > 0 ? (
                        <small>{thread.remainingCommentCount} older comment{thread.remainingCommentCount > 1 ? "s" : ""}</small>
                      ) : (
                        <small>Up to date</small>
                      )}
                      <time>{formatTimestamp(thread.lastActivityAt)}</time>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="thread-detail">
            {composerAnchor ? (
              <Fragment>
                <div className="thread-detail-header">
                  <h4>New thread</h4>
                  <button className="ghost-button" onClick={onCancelComposer}>
                    Cancel
                  </button>
                </div>
                <p className="thread-meta">
                  Anchored at line {composerAnchor.newLine ?? composerAnchor.oldLine ?? "?"}
                </p>
              </Fragment>
            ) : activeThreadPreview ? (
              <Fragment>
                <div className="thread-detail-header">
                  <div>
                    <h4>Thread</h4>
                    <p className="thread-meta">
                      Line {activeThreadPreview.anchor.newLine ?? activeThreadPreview.anchor.oldLine ?? "?"}
                    </p>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => void (activeThreadPreview.status === "open" ? onResolve() : onReopen())}
                  >
                    {activeThreadPreview.status === "open" ? "Resolve" : "Reopen"}
                  </button>
                </div>
              </Fragment>
            ) : (
              <EmptyState title="Select or create a thread" body="Click a diff line to start a thread, or select one from the list." />
            )}

            {loadingThread ? <LoadingState label="Loading thread" /> : null}

            {activeThread ? (
              <div className="thread-comments">
                {activeThread.hasMore ? (
                  <button className="ghost-button" onClick={() => void onLoadOlder()}>
                    Load older comments
                  </button>
                ) : null}
                {activeThread.comments.map((comment) => (
                  <article key={comment.id} className="comment-card">
                    <time>{formatTimestamp(comment.createdAt)}</time>
                    <p>{comment.body}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {(composerAnchor || activeThreadPreview) ? (
              <div className="comment-composer">
                <textarea
                  placeholder={composerAnchor ? "Start the thread…" : "Reply to this thread…"}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  rows={5}
                />
                <button className="primary-button" onClick={() => void submit()}>
                  {composerAnchor ? "Create thread" : "Add comment"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Fragment>
  );
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}
