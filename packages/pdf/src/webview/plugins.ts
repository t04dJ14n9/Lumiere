import type { AnyPlugin } from "@embedpdf/core";
import { annotationPlugin } from "@embedpdf/react/annotation";
import { historyPlugin } from "@embedpdf/react/history";
import { interactionPlugin } from "@embedpdf/react/interaction";
import { linkPlugin } from "@embedpdf/react/link";
import { outlinePlugin } from "@embedpdf/react/outline";
import { renderPlugin } from "@embedpdf/react/render";
import { searchPlugin } from "@embedpdf/react/search";
import { selectionPlugin } from "@embedpdf/react/selection";
import { stagePlugin } from "@embedpdf/react/stage";
import { LUMIA_ANNOTATION_TOOLS } from "../shared/annotation-tools";
import { MAX_ZOOM, MIN_ZOOM } from "../shared/zoom-steps";
import { nativeZoom, rememberedPosition } from "./reading-position";
import { layoutSettings } from "./stage-layout";
import { lumiaTextPlugin } from "./text-access";

/** The viewer shows one document under this id. */
export const DOCUMENT_ID = "pdf";
export const ZOOM_RANGE = { min: MIN_ZOOM, max: MAX_ZOOM } as const;
/** Pixels between pages (and around them). */
export const PAGE_GAP = 12;

/**
 * The EmbedPDF plugins the viewer is built from. The view starts as the
 * remembered position left it: layout, scrolling and zoom are registered
 * here, so the first layout is already the right one. The list is built once
 * per mounted viewer (EmbedPDF reads it only on mount).
 */
export function viewerPlugins(): AnyPlugin[] {
  const position = rememberedPosition();
  return [
    stagePlugin({
      ...layoutSettings(position),
      zoom: nativeZoom(position.zoom),
      minZoom: ZOOM_RANGE.min,
      maxZoom: ZOOM_RANGE.max,
      // The same room around and between pages as before, and no smaller
      // padding in a narrow pane (the Stage's own `responsive` rules, off
      // below, would shrink it). Saved places are measured from the viewer's
      // corner, not from this inset (stage-position.ts).
      padding: PAGE_GAP,
      gap: PAGE_GAP,
      responsive: [],
      // One point is one pixel at 100%, as the saved zoom percentages and
      // "Actual size" have always meant (the Stage's own 96/72 would make
      // 100% the physical size of the page).
      viewUnitsPerPoint: 1,
    }),
    // The whole-page picture is the instant backdrop and, where it covers the
    // view's pixels, all there is: tiles only sharpen what it cannot. With
    // EmbedPDF's default of 640 px, a pane wider than that (most, on a 1x
    // screen) rests soft until the tiles arrive: about 100 ms of soft frames
    // over ten scroll notches. At 1280 px (9 MB a page; the 2048 px that is
    // sharp at fit width on a 2x screen would be 22 MB) a 1x pane needs none.
    renderPlugin({ fullPage: { maxWidth: 1280 } }),
    interactionPlugin({ defaultTool: "pointer" }),
    selectionPlugin(),
    searchPlugin(),
    historyPlugin(),
    annotationPlugin({
      // A new mark is selected, and its tool stays on for the next one. Its
      // author is the viewer's identity (engine.tsx).
      afterCreate: { select: true, tool: "stay", editText: true },
      // Tools EmbedPDF does not ship: they join the hub as the document opens.
      tools: LUMIA_ANNOTATION_TOOLS,
    }),
    linkPlugin(),
    outlinePlugin(),
    // Text of a page, for look-up, backlink overlays and region text.
    lumiaTextPlugin(),
  ];
}
