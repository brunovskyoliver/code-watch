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

  return items.filter((item) => {
    const haystack = [item.title, item.subtitle, ...(item.keywords ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
