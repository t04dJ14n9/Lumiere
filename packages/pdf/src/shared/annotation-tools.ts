import type { AnnotationToolInput } from "@embedpdf/plugin-annotation";
import type { EffectivePageColors } from "./page-colors";
import { highlightToolDefaults } from "./highlight-style";

/** Lumiere's tool ids exposed in Annotate mode (spec v1 toolkit); EmbedPDF's own ids are `toV3ToolId`. */
export const ANNOTATION_TOOL_IDS = [
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
  "textComment",
  "freeText",
  "ink",
  "square",
  "circle",
  "line",
  "lineArrow",
  "polygon",
  "polyline",
  "stamp",
] as const;

export type AnnotationToolId = (typeof ANNOTATION_TOOL_IDS)[number];

export const DEFAULT_ANNOTATION_TOOL: AnnotationToolId = "highlight";

export const ANNOTATION_TOOL_LABELS: Record<AnnotationToolId, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strikeout",
  squiggly: "Squiggly",
  textComment: "Note",
  freeText: "Free text",
  ink: "Ink",
  square: "Rectangle",
  circle: "Ellipse",
  line: "Line",
  lineArrow: "Arrow",
  polygon: "Polygon",
  polyline: "Polyline",
  stamp: "Stamp",
};

export const ANNOTATION_TOOL_ICONS: Record<AnnotationToolId, string> = {
  highlight: "paintcan",
  underline: "whole-word",
  strikeout: "strike",
  squiggly: "wand",
  textComment: "comment",
  freeText: "text-size",
  ink: "edit",
  square: "symbol-ruler",
  circle: "circle-outline",
  line: "remove",
  lineArrow: "arrow-right",
  polygon: "triangle-down",
  polyline: "type-hierarchy-sub",
  stamp: "rocket",
};

export const ANNOTATION_COLOR_PRESETS = [
  "#FFE566",
  "#FF6B6B",
  "#4DABF7",
  "#51CF66",
  "#CC5DE8",
  "#212529",
] as const;

export function isAnnotationToolId(value: unknown): value is AnnotationToolId {
  return (
    typeof value === "string" &&
    (ANNOTATION_TOOL_IDS as readonly string[]).includes(value)
  );
}

/**
 * Lumiere's id for a tool where EmbedPDF 3 names it differently. `lineArrow`
 * has no EmbedPDF tool: `LUMIERE_ANNOTATION_TOOLS` registers it under its own id.
 */
const V3_TOOL_IDS: Partial<Record<AnnotationToolId, string>> = {
  textComment: "note",
  freeText: "free-text",
};

/** The interaction tool id EmbedPDF 3 knows this tool by. */
export function toV3ToolId(tool: AnnotationToolId): string {
  return V3_TOOL_IDS[tool] ?? tool;
}

/** Lumiere's tool for an interaction tool id, or null for `pointer`, the read tool and the rest. */
export function fromV3ToolId(
  id: string | null | undefined,
): AnnotationToolId | null {
  if (typeof id !== "string") {
    return null;
  }
  return ANNOTATION_TOOL_IDS.find((tool) => toV3ToolId(tool) === id) ?? null;
}

/**
 * View mode's tool: text selection, links, and empty-page pan (`scroll` on
 * the interaction hub), but no annotation editing, so a PDF's own annotations
 * cannot be selected, moved or deleted while reading (EmbedPDF's resting
 * `pointer` tool enables all of that).
 */
export const READ_TOOL_ID = "lumiere.read";

/** Annotate mode with no drawing tool: select, move and delete marks. */
export const ANNOTATE_IDLE_TOOL_ID = "pointer";

/** Whether this interaction tool is Annotate mode (a drawing tool, or the resting tool). */
export function isAnnotateModeTool(id: string | null | undefined): boolean {
  return id === ANNOTATE_IDLE_TOOL_ID || fromV3ToolId(id) !== null;
}

/**
 * Tools EmbedPDF does not ship, for `annotationPlugin({ tools })`. EmbedPDF 3
 * puts a tool on the interaction hub only when the document opens, so a tool
 * added later by `annotation.tools.register` could not be activated.
 */
export const LUMIERE_ANNOTATION_TOOLS = [
  {
    id: "lineArrow",
    extends: "line",
    defaults: { lineEndings: { start: "none", end: "open-arrow" } },
  },
] as const satisfies readonly AnnotationToolInput[];

/**
 * What a colour pick sets on a tool's defaults. Text markup, notes, ink,
 * shapes and lines take it as `color` (a shape's stroke; the fill stays
 * none); a text box also as its text colour; a stamp has none.
 */
export function toolColorDefaults(
  tool: AnnotationToolId,
  color: string,
  paper: EffectivePageColors,
): Record<string, unknown> {
  switch (tool) {
    case "highlight":
      return highlightToolDefaults(paper, color);
    case "freeText":
      return { color, fontColor: color };
    case "stamp":
      return {};
    default:
      return { color };
  }
}
