import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffLine, PaginatedFileDiff, ThreadAnchor, ThreadPreview } from "@shared/types";

export function DiffViewer({
  sessionId,
  diff,
  threadPreviews,
  onCreateThread,
  onSelectThread,
  onLoadMore
}: {
  sessionId: string;
  diff: PaginatedFileDiff;
  threadPreviews: ThreadPreview[];
  onCreateThread: (anchor: ThreadAnchor) => void;
  onSelectThread: (threadId: string) => void;
  onLoadMore: () => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const threadMap = useMemo(() => groupThreadsByLine(threadPreviews), [threadPreviews]);
  const rowVirtualizer = useVirtualizer({
    count: diff.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (diff.rows[index]?.type === "hunk" ? 36 : 28),
    overscan: 18
  });

  const lastVisibleIndex = rowVirtualizer.getVirtualItems().at(-1)?.index ?? 0;

  useEffect(() => {
    if (diff.hasMore && lastVisibleIndex >= diff.rows.length - 24) {
      onLoadMore();
    }
  }, [diff.hasMore, diff.rows.length, lastVisibleIndex, onLoadMore]);

  if (diff.isBinary) {
    return (
      <div className="binary-file-card">
        <h4>Binary file</h4>
        <p>Inline preview is disabled for binary changes in v1.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="virtual-scroll diff-scroll">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = diff.rows[virtualRow.index];
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
          const anchor = toAnchor(diff.filePath, row.line, sessionId);
          const canThread = row.line.oldLineNumber !== null || row.line.newLineNumber !== null;
          const latestPreview = firstThread?.latestComments.at(-1)?.body ?? null;

          return (
            <button
              key={row.id}
              className={`diff-line diff-line-${row.line.kind}`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => {
                if (canThread) {
                  onCreateThread(anchor);
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
                  title={latestPreview ?? undefined}
                >
                  <strong>
                    {threads.length} thread{threads.length > 1 ? "s" : ""}
                  </strong>
                  {latestPreview ? <small>{latestPreview}</small> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
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

function toAnchor(filePath: string, line: DiffLine, sessionId: string): ThreadAnchor {
  return {
    sessionId,
    filePath,
    side: line.newLineNumber !== null ? "new" : "old",
    oldLine: line.oldLineNumber,
    newLine: line.newLineNumber,
    hunkHeader: line.hunkHeader,
    lineContentHash: line.lineContentHash
  };
}
