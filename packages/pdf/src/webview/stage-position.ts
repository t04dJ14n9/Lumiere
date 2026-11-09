import type { StageCapability } from "@embedpdf/react/stage";
import type { ZoomChoice } from "../shared/view-settings";

/** Where the reader is in the document: a 1-based page and points into it. */
export interface ReadingPlace {
  page: number;
  top: number;
  left: number;
}

type PlaceReads = Pick<
  StageCapability,
  "getCurrentDestination" | "listVisiblePages" | "viewportToPage"
>;

/**
 * The page and the point of it at the viewer's top-left corner, in points
 * from the page's top-left (y down). It is what a reveal aligned to the
 * corner itself (`CORNER`, navigation.ts) puts back there, so a place read
 * here and revealed later lands where it was. The corner, not the Stage's
 * destination, which is the point `padding` in from it: the space above the
 * first page, or left of it, is no point of the page, so it reads as 0.
 * Nothing before a page is on screen.
 */
export function readingPlace(stage: PlaceReads): ReadingPlace | undefined {
  const destination = stage.getCurrentDestination();
  if (destination?.kind !== "xyz") {
    return undefined;
  }
  // A page's address is its object number; the visible list knows its index.
  const shown = stage
    .listVisiblePages()
    .find((page) => page.ref.objectNumber === destination.page.objectNumber);
  const corner = shown && stage.viewportToPage(shown.pageIndex, ORIGIN);
  if (!shown || !corner) {
    return undefined;
  }
  return {
    page: shown.pageIndex + 1,
    top: inPage(corner.y),
    left: inPage(corner.x),
  };
}

const ORIGIN = { x: 0, y: 0 };

/** A coordinate on the page: never before its edge, in hundredths of a point like the Stage's. */
function inPage(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

type ZoomReads = Pick<StageCapability, "getZoomMode" | "getZoomLevel">;

/**
 * The zoom as a reading position keeps it: a fit mode while the viewer
 * follows one, else the exact level in percent. The Stage's other modes
 * (automatic, fit all) are not choices Lumia offers, so they read as the
 * level they resolved to.
 */
export function zoomChoice(stage: ZoomReads): ZoomChoice {
  const mode = stage.getZoomMode();
  if (mode === "fit-width") {
    return "fitWidth";
  }
  return mode === "fit-page" ? "fitPage" : stage.getZoomLevel() * 100;
}
