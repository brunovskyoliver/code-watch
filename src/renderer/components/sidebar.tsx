import { startTransition, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectSummary, ReviewSessionSummary } from "@shared/types";

type SidebarRow =
  | { type: "project"; id: string; project: ProjectSummary; active: boolean }
  | { type: "session"; id: string; projectId: string; session: ReviewSessionSummary; active: boolean }
  | { type: "remove"; id: string; projectId: string };

export function Sidebar({
  projects,
  sessionsByProject,
  activeProjectId,
  activeSessionId,
  onAddProject,
  onRemoveProject,
  onSelectProject,
  onSelectSession
}: {
  projects: ProjectSummary[];
  sessionsByProject: Record<string, ReviewSessionSummary[]>;
  activeProjectId: string | null;
  activeSessionId: string | null;
  onAddProject: () => void;
  onRemoveProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (projectId: string, sessionId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo<SidebarRow[]>(() => {
    const nextRows: SidebarRow[] = [];

    for (const project of projects) {
      const active = project.id === activeProjectId;
      nextRows.push({
        type: "project",
        id: project.id,
        project,
        active
      });

      if (active) {
        const sessions = sessionsByProject[project.id] ?? [];
        for (const session of sessions) {
          nextRows.push({
            type: "session",
            id: `${project.id}:${session.id}`,
            projectId: project.id,
            session,
            active: activeSessionId === session.id
          });
        }

        nextRows.push({
          type: "remove",
          id: `${project.id}:remove`,
          projectId: project.id
        });
      }
    }

    return nextRows;
  }, [activeProjectId, activeSessionId, projects, sessionsByProject]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row?.type === "project") {
        return 96;
      }

      return 56;
    },
    overscan: 8
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Code Watch</p>
          <h1>Projects</h1>
        </div>
        <button className="ghost-button" onClick={onAddProject}>
          Add Repo
        </button>
      </div>

      <div ref={parentRef} className="sidebar-scroll">
        {projects.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <h3>No repositories yet</h3>
            <p>Add a local Git project to start reviewing your current branch.</p>
            <button className="primary-button" onClick={onAddProject}>
              Add repository
            </button>
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) {
                return null;
              }

              if (row.type === "project") {
                const { project, active } = row;
                return (
                  <button
                    key={row.id}
                    className={`sidebar-item project-button ${active ? "project-card-active" : ""}`}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                    onClick={() => {
                      startTransition(() => {
                        onSelectProject(project.id);
                      });
                    }}
                  >
                    <div>
                      <strong>{project.name}</strong>
                      <p>{project.repoPath}</p>
                    </div>
                    <div className="project-meta">
                      <span className="badge">{project.currentBranch ?? "detached"}</span>
                      {project.dirty ? <span className="badge badge-warning">Dirty</span> : null}
                    </div>
                  </button>
                );
              }

              if (row.type === "session") {
                return (
                  <button
                    key={row.id}
                    className={`sidebar-item session-button ${row.active ? "session-button-active" : ""}`}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                    onClick={() => {
                      startTransition(() => {
                        onSelectSession(row.projectId, row.session.id);
                      });
                    }}
                  >
                    <span>{row.session.branchName}</span>
                    <small>{shortSha(row.session.headSha)}</small>
                  </button>
                );
              }

              return (
                <button
                  key={row.id}
                  className="sidebar-item danger-button sidebar-remove"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={() => onRemoveProject(row.projectId)}
                >
                  Remove
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
