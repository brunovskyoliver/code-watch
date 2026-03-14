export interface CommandMenuItem {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string[];
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
