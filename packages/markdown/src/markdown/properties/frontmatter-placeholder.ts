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
   * the floor would only add a gap; otherwise the real sheet may be taller
   * than the skeleton, and the floor is the expanded estimate.
   */
  minHeight: number;
}

export function frontmatterPlaceholder(source: string): FrontmatterPlaceholder {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  const sheet = skeletonSheet(header?.body ?? "");
  return {
    markup: skeletonMarkup(sheet),
    isExact: sheet.isExact,
    minHeight: sheet.isExact ? 0 : frontmatterPlaceholderHeight(source),
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
 * It always reserves the expanded sheet, even for a note whose Properties are
 * stored collapsed (`properties/collapse-store`). That flag lives in the
 * host's preference store and reaches the webview only over the Properties
 * RPC, after the Properties plugin has configured, which is also when this
 * placeholder stops matching. livePreview may not import that plugin, and the
 * editor protocol's `ready` payload that could carry the flag is a contract
 * with the host, so a collapsed note still paints one expanded-height frame
 * first.
 */
export function frontmatterPlaceholderHeight(source: string): number {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  if (!header) {
    return 0;
  }
  const rows = header.body.split(/\r?\n/).filter(opensTopLevelEntry).length;
  if (rows === 0) {
    return COLLAPSED;
  }
  return SHEET_CHROME + rows * ROW + (rows - 1) * ROW_GAP;
}
