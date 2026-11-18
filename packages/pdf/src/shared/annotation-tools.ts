import type { EffectivePageColors } from "./page-colors";
import { highlightToolDefaults } from "./highlight-style";

/**
 * The marks the context menu makes of selected text: Highlight, and the
 * Mark Text submenu's Underline, Strikeout and Squiggly. EmbedPDF's text
 * tools have the same ids.
 */
export const MARK_TOOL_IDS = [
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
] as const;

export type MarkToolId = (typeof MARK_TOOL_IDS)[number];

export function isMarkToolId(value: unknown): value is MarkToolId {
  return (
    typeof value === "string" &&
    (MARK_TOOL_IDS as readonly string[]).includes(value)
  );
}

/**
 * The Change Color submenu, in its order. Yellow is the highlight's own
 * colour on light paper (`HIGHLIGHT_BY_PAPER.normal`).
 */
export const ANNOTATION_COLORS = [
  { id: "yellow", label: "Yellow", value: "#FFE566" },
  { id: "red", label: "Red", value: "#FF6B6B" },
  { id: "blue", label: "Blue", value: "#4DABF7" },
  { id: "green", label: "Green", value: "#51CF66" },
  { id: "purple", label: "Purple", value: "#CC5DE8" },
  { id: "black", label: "Black", value: "#212529" },
] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]["value"];

export const ANNOTATION_COLOR_PRESETS: readonly AnnotationColor[] =
  ANNOTATION_COLORS.map((color) => color.value);

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return (
    typeof value === "string" &&
    (ANNOTATION_COLOR_PRESETS as readonly string[]).includes(value)
  );
}

/**
 * The reading tool: text selection, links, and empty-page pan (`scroll` on
 * the interaction hub), but no annotation editing, so marks are never
 * selected, moved or deleted by hand. Marks are made and changed from the
 * context menu instead (`webview/mark-menu.ts`).
 */
export const READ_TOOL_ID = "lumiere.read";

/**
 * What a colour pick changes on a mark of this subtype. Text markup, notes,
 * ink, shapes and lines take it as `color` (a shape's stroke; the fill stays
 * none); a highlight also its opacity and blend for the paper; a text box
 * also its text colour; a stamp has none.
 */
export function markColorPatch(
  subtype: string,
  color: string,
  paper: EffectivePageColors,
): Record<string, unknown> {
  switch (subtype) {
    case "highlight":
      return highlightToolDefaults(paper, color);
    case "free-text":
      return { color, fontColor: color };
    case "stamp":
      return {};
    default:
      return { color };
  }
}
