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
import { LUMIERE_ANNOTATION_TOOLS } from "../shared/annotation-tools";
import { pagePictureWidth, type PaneSize } from "../shared/page-picture-width";
import { MAX_ZOOM, MIN_ZOOM } from "../shared/zoom-steps";
import { nativeZoom, rememberedPosition } from "./reading-position";
import { layoutSettings } from "./stage-layout";
import { lumiereTextPlugin } from "./text-access";

/** The viewer shows one document under this id. */
export const DOCUMENT_ID = "pdf";
const ZOOM_RANGE = { min: MIN_ZOOM, max: MAX_ZOOM } as const;
/** Pixels between pages (and around them). */
export const PAGE_GAP = 12;

/**
 * The EmbedPDF plugins the viewer is built from. The view starts as the
 * remembered position left it: layout, scrolling and zoom are registered
 * here, so the first layout is already the right one. The list is built once
 * per mounted viewer (EmbedPDF reads it only on mount), for the pane it
 * opens in.
 */
export function viewerPlugins(
  pane: PaneSize = { cssWidth: 0, pixelRatio: 1 },
): AnyPlugin[] {
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
    // view's pixels, all there is: tiles only sharpen what it cannot. Drawn
    // as wide as the pane's own pixels (shared/page-picture-width.ts), a page
    // at fit width wants no tiles, which also keeps every wheel event from
    // planning them again. With EmbedPDF's default of 640 px, a pane wider
    // than that rested soft until the tiles arrived: about 100 ms of soft
    // frames over ten scroll notches.
    renderPlugin({ fullPage: { maxWidth: pagePictureWidth(pane) } }),
    interactionPlugin({ defaultTool: "pointer" }),
    selectionPlugin(),
    searchPlugin(),
    historyPlugin(),
    annotationPlugin({
      // A new mark is selected, and its tool stays on for the next one. Its
      // author is the viewer's identity (engine.tsx).
      afterCreate: { select: true, tool: "stay", editText: true },
      // Tools EmbedPDF does not ship: they join the hub as the document opens.
      tools: LUMIERE_ANNOTATION_TOOLS,
    }),
    linkPlugin(),
    outlinePlugin(),
    // Text of a page, for look-up, backlink overlays and region text.
    lumiereTextPlugin(),
  ];
}
