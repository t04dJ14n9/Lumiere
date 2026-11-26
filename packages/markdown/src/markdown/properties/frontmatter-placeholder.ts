import { headerParts } from "./header-parts";
import { skeletonMarkup, skeletonSheet } from "./frontmatter-skeleton";

/**
 * Sheet chrome / row floors mirrored from `properties/estimated-height`
 * (COLLAPSED / SHEET_CHROME / ROW / ROW_GAP) — kept local so livePreview does
 * not import the properties plugin. Reserves near the expanded sheet height
 * until the real Properties widget mounts so the heading does not jump.
 */
const TEXT = 14;
const LINE = TEXT * 1.5;
const VALUE_MIN = TEXT * 1.75 + 4;
const ROW = VALUE_MIN;
const ROW_GAP = 3;
const HEADING = LINE + 8;
const ADD_BUTTON = 8 + 8 + LINE;
const SHEET_PADDING = 8 + 32;
const SHEET_CHROME = SHEET_PADDING + HEADING + ADD_BUTTON;
const COLLAPSED = SHEET_PADDING + HEADING;

/**
 * What the placeholder shows until the real sheet mounts: the sheet's own
 * rows, muted (`frontmatterPlaceholder`), so the sheet replaces it without
 * the keys or the text below moving.
 */
export const FRONTMATTER_PLACEHOLDER_CLASS =
  "hybrid-properties mw-frontmatter-placeholder";

/** Bound fence probes so match never slices a multi-MB note. */
export const FRONTMATTER_PROBE_MAX = 64 * 1024;

export interface FrontmatterPlaceholder {
  markup: string;
  /** Whether every row is drawn in the box the sheet will use. */
  isExact: boolean;
  /**
   * A floor for the placeholder's height, 0 for none. When every row is drawn
   * exactly the browser lays them out as the sheet will, at any width, and
   * the floor would only add a gap, as it would under a collapsed sheet's
   * heading; otherwise the real sheet may be taller than the skeleton, and
   * the floor is the expanded estimate.
   */
  minHeight: number;
}

export function frontmatterPlaceholder(
  source: string,
  isCollapsed = false,
): FrontmatterPlaceholder {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  const sheet = skeletonSheet(header?.body ?? "");
  return {
    markup: skeletonMarkup(sheet, { isCollapsed }),
    isExact: sheet.isExact,
    // A collapsed sheet is its heading alone, whatever its rows hold.
    minHeight:
      sheet.isExact || isCollapsed
        ? 0
        : frontmatterPlaceholderHeight(source, false),
  };
}

/**
 * True for a line that opens a top-level mapping entry, i.e. one Properties
 * row. Blanks, indented continuations, `#` comments and flush `- item` lines
 * (YAML lets a sequence sit unindented under its key) belong to a row or to
 * none, so they must not add a control to the reserve.
 */
function opensTopLevelEntry(line: string): boolean {
  if (!line.trim() || /^[ \t#]/.test(line)) {
    return false;
  }
  return !/^-(?:[ \t]|$)/.test(line);
}

/**
 * Rough expanded Properties height from YAML body lines — no YAML parse.
 * Each top-level key reserves one control; everything else is ignored so
 * multiline values stay a floor, not a guess.
 *
 * It reserves the expanded sheet unless the note's Properties are stored
 * collapsed (`properties/collapse-store`): the host reads that flag from the
 * workspace's storage and says it in the `ready` answer and in the snapshot's
 * layout key (`shared/properties-collapse.ts`), so the sheet's heading alone
 * is reserved for such a note, not an expanded sheet that then shrinks.
 */
export function frontmatterPlaceholderHeight(
  source: string,
  isCollapsed = false,
): number {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  if (!header) {
    return 0;
  }
  if (isCollapsed) {
    return COLLAPSED;
  }
  const rows = header.body.split(/\r?\n/).filter(opensTopLevelEntry).length;
  if (rows === 0) {
    return COLLAPSED;
  }
  return SHEET_CHROME + rows * ROW + (rows - 1) * ROW_GAP;
}
