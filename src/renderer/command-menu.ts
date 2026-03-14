import type { ReviewSessionSummary } from "@shared/types";

export interface CommandMenuItem {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string[];
}

export interface ReviewSessionCommandMenuItem extends CommandMenuItem {
  projectId: string;
  sessionId: string;
  active: boolean;
}

export function filterCommandMenuItems<T extends CommandMenuItem>(items: readonly T[], query: string): T[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return [...items];
  }

  return items.filter((item) => {
    const haystack = [item.title, item.subtitle, ...(item.keywords ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function createReviewSessionCommandMenuItems(
  sessions: readonly ReviewSessionSummary[],
  activeSessionId: string | null
): ReviewSessionCommandMenuItem[] {
  return sessions.map((session) => ({
    id: `review-session:${session.id}`,
    projectId: session.projectId,
    sessionId: session.id,
    title: session.branchName,
    subtitle: `${shortSha(session.headSha)} · base ${session.baseBranch}${session.id === activeSessionId ? " · current" : ""}`,
    keywords: [session.branchName, session.baseBranch, session.headSha],
    active: session.id === activeSessionId
  }));
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
