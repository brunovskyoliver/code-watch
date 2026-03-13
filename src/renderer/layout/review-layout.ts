export const reviewPaneIds = ["files", "diff", "threads"] as const;

export type ReviewPaneId = (typeof reviewPaneIds)[number];

export type ReviewLayoutState = {
  order: ReviewPaneId[];
  visibility: Record<ReviewPaneId, boolean>;
  sizes: Record<ReviewPaneId, number>;
};

const DEFAULT_VISIBILITY: Record<ReviewPaneId, boolean> = {
  files: true,
  diff: true,
  threads: true
};

const DEFAULT_SIZES: Record<ReviewPaneId, number> = {
  files: 24,
  diff: 46,
  threads: 30
};

export function createDefaultReviewLayout(): ReviewLayoutState {
  return {
    order: [...reviewPaneIds],
    visibility: { ...DEFAULT_VISIBILITY },
    sizes: { ...DEFAULT_SIZES }
  };
}

export function parseStoredReviewLayout(raw: string | null): ReviewLayoutState {
  if (!raw) {
    return createDefaultReviewLayout();
  }

  try {
    return sanitizeReviewLayout(JSON.parse(raw));
  } catch {
    return createDefaultReviewLayout();
  }
}

export function sanitizeReviewLayout(value: unknown): ReviewLayoutState {
  const candidate = isRecord(value) ? value : {};
  const order = sanitizeOrder(candidate.order);
  const visibility = reviewPaneIds.reduce<Record<ReviewPaneId, boolean>>((result, paneId) => {
    result[paneId] = typeof candidate.visibility?.[paneId] === "boolean" ? candidate.visibility[paneId] : DEFAULT_VISIBILITY[paneId];
    return result;
  }, {} as Record<ReviewPaneId, boolean>);

  if (!Object.values(visibility).some(Boolean)) {
    visibility.diff = true;
  }

  const sizes = reviewPaneIds.reduce<Record<ReviewPaneId, number>>((result, paneId) => {
    const nextSize = candidate.sizes?.[paneId];
    result[paneId] = typeof nextSize === "number" && Number.isFinite(nextSize) && nextSize > 0 ? nextSize : DEFAULT_SIZES[paneId];
    return result;
  }, {} as Record<ReviewPaneId, number>);

  return { order, visibility, sizes };
}

export function getVisibleReviewPanes(layout: ReviewLayoutState): ReviewPaneId[] {
  return layout.order.filter((paneId) => layout.visibility[paneId]);
}

export function getNormalizedPaneSizes(layout: ReviewLayoutState): Record<ReviewPaneId, number> {
  const visiblePanes = getVisibleReviewPanes(layout);
  const normalized = reviewPaneIds.reduce<Record<ReviewPaneId, number>>((result, paneId) => {
    result[paneId] = 0;
    return result;
  }, {} as Record<ReviewPaneId, number>);

  if (visiblePanes.length === 0) {
    normalized.diff = 100;
    return normalized;
  }

  const total = visiblePanes.reduce((sum, paneId) => sum + layout.sizes[paneId], 0);
  const fallbackTotal = visiblePanes.reduce((sum, paneId) => sum + DEFAULT_SIZES[paneId], 0);
  const divisor = total > 0 ? total : fallbackTotal;

  for (const paneId of visiblePanes) {
    const basis = total > 0 ? layout.sizes[paneId] : DEFAULT_SIZES[paneId];
    normalized[paneId] = (basis / divisor) * 100;
  }

  return normalized;
}

export function reorderReviewPanes(
  layout: ReviewLayoutState,
  draggedPaneId: ReviewPaneId,
  targetPaneId: ReviewPaneId
): ReviewLayoutState {
  if (draggedPaneId === targetPaneId) {
    return layout;
  }

  const currentIndex = layout.order.indexOf(draggedPaneId);
  const targetIndex = layout.order.indexOf(targetPaneId);
  if (currentIndex < 0 || targetIndex < 0) {
    return layout;
  }

  const nextOrder = [...layout.order];
  const [draggedPane] = nextOrder.splice(currentIndex, 1);
  if (!draggedPane) {
    return layout;
  }
  nextOrder.splice(targetIndex, 0, draggedPane);

  return {
    ...layout,
    order: nextOrder
  };
}

export function setReviewPaneVisibility(
  layout: ReviewLayoutState,
  paneId: ReviewPaneId,
  visible: boolean
): ReviewLayoutState {
  if (layout.visibility[paneId] === visible) {
    return layout;
  }

  if (!visible) {
    const visibleCount = getVisibleReviewPanes(layout).length;
    if (visibleCount <= 1) {
      return layout;
    }
  }

  return {
    ...layout,
    visibility: {
      ...layout.visibility,
      [paneId]: visible
    }
  };
}

function sanitizeOrder(value: unknown): ReviewPaneId[] {
  const order = Array.isArray(value) ? value.filter(isReviewPaneId) : [];
  const seen = new Set<ReviewPaneId>();
  const unique = order.filter((paneId) => {
    if (seen.has(paneId)) {
      return false;
    }

    seen.add(paneId);
    return true;
  });

  for (const paneId of reviewPaneIds) {
    if (!seen.has(paneId)) {
      unique.push(paneId);
    }
  }

  return unique;
}

function isReviewPaneId(value: unknown): value is ReviewPaneId {
  return typeof value === "string" && reviewPaneIds.includes(value as ReviewPaneId);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
