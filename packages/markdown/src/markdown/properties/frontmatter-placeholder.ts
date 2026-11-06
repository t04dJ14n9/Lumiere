import { headerParts } from "./header-parts";

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
 * What the placeholder shows: the collapsed Properties bar, reserving the
 * expanded height (`frontmatterPlaceholderHeight`) as a minimum so the body
 * below stays put when the real sheet replaces it.
 */
export const FRONTMATTER_PLACEHOLDER_CLASS =
  "hybrid-properties mw-frontmatter-placeholder";
export const FRONTMATTER_PLACEHOLDER_MARKUP =
  '<div class="properties metadata-container is-collapsed">' +
  '<div class="metadata-properties-heading" data-properties-heading>' +
  '<span class="metadata-properties-title">Properties</span></div></div>';

/** Bound fence probes so match never slices a multi-MB note. */
export const FRONTMATTER_PROBE_MAX = 64 * 1024;

/**
 * Rough expanded Properties height from YAML body lines — no YAML parse.
 * Top-level (non-indented, non-empty) rows each reserve one control; indented
 * continuations are ignored so multiline values stay a floor, not a guess.
 */
export function frontmatterPlaceholderHeight(source: string): number {
  const header = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX));
  if (!header) {
    return 0;
  }
  let rows = 0;
  for (const line of header.body.split(/\r?\n/)) {
    if (!line.trim() || /^[ \t]/.test(line)) {
      continue;
    }
    rows += 1;
  }
  if (rows === 0) {
    return COLLAPSED;
  }
  return SHEET_CHROME + rows * ROW + (rows - 1) * ROW_GAP;
}
