import { startTransition, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChangedFile } from "@shared/types";

export function FileList({
  files,
  selectedFilePath,
  onSelect
}: {
  files: ChangedFile[];
  selectedFilePath: string | null;
  onSelect: (filePath: string) => Promise<void>;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10
  });

  return (
    <div ref={parentRef} className="virtual-scroll file-list-scroll">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          if (!file) {
            return null;
          }

          return (
            <button
              key={file.id}
              className={`file-row ${selectedFilePath === file.filePath ? "file-row-active" : ""}`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => {
                startTransition(() => {
                  void onSelect(file.filePath);
                });
              }}
            >
              <div className="file-row-main">
                <strong>{file.filePath}</strong>
                <p>
                  {file.status}
                  {file.isBinary ? " · binary" : ""}
                </p>
              </div>
              <div className="file-row-meta">
                {file.additions !== null ? <span className="diff-add">+{file.additions}</span> : null}
                {file.deletions !== null ? <span className="diff-delete">-{file.deletions}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
