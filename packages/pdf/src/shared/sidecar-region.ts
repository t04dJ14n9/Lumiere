import type { PageRect } from "./geometry";
import type { SidecarHighlight } from "./sidecar-format";
import type { RegionSelection } from "./selection";

/** The selection a highlight stands for: its box, its quote and its id. */
export function regionOf(highlight: SidecarHighlight): RegionSelection {
  const rect: PageRect = [
    Math.min(...highlight.segmentRects.map((r) => r.x)),
    Math.min(...highlight.segmentRects.map((r) => r.y)),
    Math.max(...highlight.segmentRects.map((r) => r.x + r.w)),
    Math.max(...highlight.segmentRects.map((r) => r.y + r.h)),
  ];
  const text = highlight.quote.trim();
  return {
    kind: "region",
    page: highlight.page,
    rect,
    ...(text ? { text } : {}),
    highlightId: highlight.id,
    mark: true,
  };
}
