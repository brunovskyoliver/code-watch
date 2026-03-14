export interface CommandMenuItem {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string[];
}

export interface BranchCommandMenuItem extends CommandMenuItem {
  projectId: string;
  branch: string;
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

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreCommandMenuItem(item, query.toLowerCase(), terms)
    }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

export function createBranchCommandMenuItems(
  projectId: string,
  branches: readonly string[],
  activeBranch: string | null
): BranchCommandMenuItem[] {
  return branches.map((branch) => ({
    id: `branch:${projectId}:${branch}`,
    projectId,
    branch,
    title: branch,
    subtitle: branch === activeBranch ? "Current base branch" : "Switch review to this base branch",
    keywords: branch.split("/"),
    active: branch === activeBranch
  }));
}

function scoreCommandMenuItem(item: CommandMenuItem, normalizedQuery: string, terms: readonly string[]): number | null {
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  const keywords = (item.keywords ?? []).map((keyword) => keyword.toLowerCase());

  let score = title === normalizedQuery ? 4_000 : 0;
  score += title.startsWith(normalizedQuery) ? 2_000 : 0;

  for (const term of terms) {
    const termScore = scoreCommandMenuTerm(title, subtitle, keywords, term);
    if (termScore === null) {
      return null;
    }
    score += termScore;
  }

  return score;
}

function scoreCommandMenuTerm(
  title: string,
  subtitle: string,
  keywords: readonly string[],
  term: string
): number | null {
  if (title === term) {
    return 1_000;
  }

  if (title.startsWith(term)) {
    return 800;
  }

  if (keywords.some((keyword) => keyword === term)) {
    return 700;
  }

  if (keywords.some((keyword) => keyword.startsWith(term))) {
    return 600;
  }

  if (title.includes(term)) {
    return 500;
  }

  if (subtitle.includes(term)) {
    return 300;
  }

  return null;
}
