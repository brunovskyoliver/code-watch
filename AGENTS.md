# AGENTS.md

## Task Completion Requirements

- `bun install` must succeed with `bun.lock` committed.
- All of `bun run test`, `bun run dev`, and `bun run package` must pass before considering substantial work complete.
- Use Bun for installs and scripts by default.
- If Electron tooling requires a blocked lifecycle script, add only that exact package to `trustedDependencies`, rerun `bun install`, and document why.
- If `fmt`, `lint`, or `typecheck` scripts are added later, they become part of the completion gate.

## Project Snapshot

Code Watch is a macOS-first Electron desktop app for local, read-only Git review of the checked-out branch against a per-project base branch.

The app is performance-first and local-only:

- no remote review flows
- no repo-mutating Git actions
- no side-by-side diff in v1
- no Codex integration in v1, but a clean assistant seam must exist

This repository is still early. Prefer changes that improve long-term structure, typed boundaries, and runtime predictability over short-term patches.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Predictable behavior under load, watcher bursts, session refreshes, and partial failures.
4. Strict Electron security boundaries.

If a tradeoff is required, choose correctness, responsiveness, and maintainability over convenience.

## Architecture Boundaries

- Main process owns Git CLI access, SQLite, repo watching, diff parsing, diff caching, logging, and IPC handlers.
- Preload exposes a narrow typed bridge on `window.codeWatch`.
- Renderer owns presentation, local interaction state, virtualization, and optimistic UI only.
- Renderer must never access `fs`, `child_process`, Git, or SQLite directly.
- All filesystem and Git access must flow through preload/main IPC.

## Source Layout

- `src/main`: Electron main process, IPC handlers, Git services, database, watchers, and heavy diff work.
- `src/preload`: typed bridge exposed to the renderer.
- `src/renderer`: React UI, Zustand state, panes, thread UX, and virtualization.
- `src/shared`: shared Zod schemas, TypeScript contracts, and assistant/provider types.

Keep shared code schema-first and boundary-oriented. Do not leak main-process runtime concerns into renderer code.

## Review Semantics

- Only valid local Git repositories can be added.
- Stored project paths should resolve to the repo top-level.
- Default base branch detection should prefer remote `HEAD`, then `main`, then `master`, with user override persisted.
- Opening a project should compare `HEAD` to `merge-base(HEAD, baseBranch)` using committed changes only.
- Dirty working tree state is surfaced separately and must not change committed diff results.
- Reopen an existing session when `branch + baseBranch + headSha` matches; create a new session snapshot when `HEAD` changes.
- Binary files are listed with metadata only. No inline preview in v1.

## Performance Rules

- Virtualize every potentially long collection: project/session sidebar, changed file list, diff content, and thread lists.
- Keep diff parsing and normalization out of the renderer hot path.
- Cache parsed diff view models in main, keyed by session and file identity.
- Collapse long thread history by default. Inline diff UI should stay lightweight and show summaries plus latest comments only.
- Load older comments incrementally in the thread panel.
- Use React concurrency tools where they materially improve large selection changes or pane switches.
- Debounce and coalesce repo watcher bursts.
- Avoid features that jeopardize scroll smoothness or file-switch latency.

## Data and Persistence

- SQLite lives in `app.getPath("userData")/code-watch.db`.
- WAL mode must stay enabled.
- Migrations run on startup and should be forward-safe.
- Keep review, thread, and comment data normalized.
- Persist multiple review sessions per project for branch history browsing.

## Maintainability

- Extract shared logic instead of duplicating behavior across services, IPC handlers, or renderer stores.
- Prefer small, typed modules with explicit responsibilities.
- Validate IPC inputs and boundary-crossing data with Zod.
- Avoid barrel files for large runtime surfaces if they blur ownership.
- Do not add renderer-only shortcuts that bypass the main/preload architecture.
- When changing domain behavior, update shared schemas and types first so drift is visible immediately.

## Electron and Operational Rules

- Keep `contextIsolation` enabled and renderer privileges minimal.
- Treat preload APIs as a public contract; evolve them deliberately.
- Log operational failures with enough context to debug watcher, Git, and database issues.
- Design for branch changes, app relaunch, stale caches, and repo state churn without corrupting session history.

## Assistant Provider Seam

- Keep assistant integration behind a shared `ReviewAssistantProvider` boundary.
- Ship only a no-op provider in v1 unless scope changes explicitly.
- Do not couple review/session/thread storage to a specific assistant implementation.

## Preferred Workflow

1. Understand whether the change belongs in main, preload, renderer, or shared.
2. Preserve the typed IPC contract before touching UI behavior.
3. Keep heavy computation in main and ship normalized data to the renderer.
4. Verify Bun workflow and regression risk before closing the task.

## References

- Electron Forge: https://www.electronforge.io/
- Electron Forge CLI packaging notes: https://www.electronforge.io/cli
- Bun install and lockfile behavior: https://bun.sh/docs/cli/install
- Bun trusted dependency model: https://bun.sh/docs/install/lifecycle
