import {
  createDefaultReviewLayout,
  getNormalizedPaneSizes,
  getVisibleReviewPanes,
  parseStoredReviewLayout,
  reorderReviewPanes,
  setReviewPaneVisibility
} from "@renderer/layout/review-layout";

describe("review-layout", () => {
  it("falls back to the default layout when persisted state is invalid", () => {
    const layout = parseStoredReviewLayout("{not-json");

    expect(layout).toEqual(createDefaultReviewLayout());
  });

  it("restores missing panes and keeps at least one pane visible", () => {
    const layout = parseStoredReviewLayout(
      JSON.stringify({
        order: ["threads", "threads"],
        visibility: {
          files: false,
          diff: false,
          threads: false
        },
        sizes: {
          threads: 64
        }
      })
    );

    expect(layout.order).toEqual(["threads", "files", "diff"]);
    expect(layout.visibility.diff).toBe(true);
    expect(layout.sizes.files).toBeGreaterThan(0);
  });

  it("reorders panes without dropping any layout state", () => {
    const layout = reorderReviewPanes(createDefaultReviewLayout(), "threads", "files");

    expect(layout.order).toEqual(["threads", "files", "diff"]);
    expect(getVisibleReviewPanes(layout)).toEqual(["threads", "files", "diff"]);
  });

  it("prevents hiding the final visible pane", () => {
    let layout = createDefaultReviewLayout();
    layout = setReviewPaneVisibility(layout, "files", false);
    layout = setReviewPaneVisibility(layout, "threads", false);
    layout = setReviewPaneVisibility(layout, "diff", false);

    expect(layout.visibility.diff).toBe(true);
    expect(getVisibleReviewPanes(layout)).toEqual(["diff"]);
  });

  it("normalizes the visible pane sizes", () => {
    let layout = createDefaultReviewLayout();
    layout = setReviewPaneVisibility(layout, "threads", false);

    const sizes = getNormalizedPaneSizes(layout);

    expect(Math.round(sizes.files + sizes.diff)).toBe(100);
    expect(sizes.threads).toBe(0);
    expect(sizes.diff).toBeGreaterThan(sizes.files);
  });
});
