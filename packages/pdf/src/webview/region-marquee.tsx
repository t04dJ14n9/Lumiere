import { pageRefsEqual, usePage } from "@embedpdf/react/runtime";
import React, { useSyncExternalStore } from "react";
import { onRegionDragChange, regionDrag } from "./region-drag";

/**
 * The box of a region being dragged, on the page it began on. EmbedPDF's
 * selection layer drew it in v2; a region is Lumiere's own gesture now.
 */
export function RegionMarquee(): React.JSX.Element | null {
  const page = usePage();
  const drag = useSyncExternalStore(onRegionDragChange, regionDrag);
  if (!drag || !pageRefsEqual(drag.page, page.ref)) {
    return null;
  }
  const { from, to } = drag;
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  // A press that has not moved yet is not a box.
  if (width === 0 && height === 0) {
    return null;
  }
  const scale = page.transform.viewScale;
  return (
    <div
      className="region-marquee"
      style={{
        left: Math.min(from.x, to.x) * scale,
        top: Math.min(from.y, to.y) * scale,
        width: width * scale,
        height: height * scale,
      }}
    />
  );
}
