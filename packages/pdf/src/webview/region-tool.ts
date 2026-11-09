import type { PageRef } from "@embedpdf/engine";
import {
  samplePointOn,
  type InteractionHandler,
  type InteractionHostCapability,
} from "@embedpdf/plugin-interaction/contract/host";
import { READ_TOOL_ID } from "../shared/annotation-tools";
import {
  beginRegionDrag,
  cancelRegionDrag,
  endRegionDrag,
  moveRegionDrag,
} from "./region-drag";

/**
 * The hub tool for the Select Region tool: drags draw a region anywhere on a
 * page, over text too. In reading mode a region is drawn only by a drag that
 * starts on empty space, and only while `lumiere.pdf.regions.enabled` is on.
 */
export const REGION_TOOL_ID = "lumiere.pdf.selectRegion";

/**
 * Below the text selection handler (60), which takes a press on text and
 * declines one off it, so a press on empty space falls to this one.
 */
const EMPTY_SPACE_PRIORITY = 56;

/** A page's size in points, or undefined for a page the document lacks. */
export type PageSize = (
  page: PageRef,
) => { width: number; height: number } | undefined;

/**
 * Put the region tool and the empty-space drag on the interaction hub;
 * returns how to take them off. A tool that is removed while active stays
 * active as an inert one, so the caller leaves it first.
 */
export function registerRegionTools(
  interaction: InteractionHostCapability,
  pageSize: PageSize,
): () => void {
  const removeTool = interaction.registerTool(
    {
      id: REGION_TOOL_ID,
      cursor: "crosshair",
      // One finger draws the box, as the mouse does: a drag that drew
      // nothing would be a page scroll the tool is there to replace.
      touch: "draw",
      // Links stay clickable: their anchors take a press of their own.
      enables: new Set(["link-nav"]),
      onPointerDown: ({ page, point }) => {
        beginRegionDrag(page, point);
        return true;
      },
      onPointerMove: ({ page, point }) => moveRegionDrag(point, pageSize(page)),
      onPointerUp: ({ page, point }) => endRegionDrag(point, pageSize(page)),
    },
    { replace: true },
  );
  const removeHandler = interaction.registerHandler(
    emptySpaceHandler(pageSize),
  );
  return () => {
    cancelRegionDrag();
    removeHandler();
    removeTool();
  };
}

/** A drag from empty space, while reading, draws a region. */
function emptySpaceHandler(pageSize: PageSize): InteractionHandler {
  /** The page the gesture began on: it goes on there, off the page too. */
  let home: PageRef | undefined;
  return {
    id: "lumia-region",
    priority: EMPTY_SPACE_PRIORITY,
    enabledFor: (tool) => tool.id === READ_TOOL_ID,
    onPointerDown: (sample) => {
      if (!sample.page) {
        return false;
      }
      home = sample.page.ref;
      beginRegionDrag(home, sample.page.point);
      return true;
    },
    onPointerMove: (sample) => {
      const point = home && samplePointOn(sample, home);
      if (home && point) {
        moveRegionDrag(point, pageSize(home));
      }
    },
    onPointerUp: (sample) => {
      const point = home && samplePointOn(sample, home);
      if (home && point) {
        endRegionDrag(point, pageSize(home));
      } else {
        cancelRegionDrag();
      }
      home = undefined;
    },
    onPointerCancel: () => {
      home = undefined;
      cancelRegionDrag();
    },
  };
}
