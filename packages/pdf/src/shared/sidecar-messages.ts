/**
 * The messages of sidecar highlights (see sidecar-format.ts), between the
 * extension and the untrusted viewer. Both directions are checked field by
 * field: a highlight from the viewer is written into a file in the
 * workspace, one from the host comes from a file anyone can edit.
 *
 *   host                                 viewer
 *    │  sidecar { highlights | null } ►   the PDF's sidecar highlights, or
 *    │                                    null: this host keeps none, and
 *    │                                    the highlight tool writes the PDF
 *    │  ◄──── sidecarWrite { load, op }   create, change or delete one
 */
import {
  CONTEXT_LENGTH,
  isHighlightId,
  MAX_QUOTE_LENGTH,
  type SegmentRect,
  type SidecarHighlight,
} from "./sidecar-format";

export type SidecarWrite =
  | {
      type: "sidecarWrite";
      load: number;
      op: "upsert";
      highlight: SidecarHighlight;
    }
  | { type: "sidecarWrite"; load: number; op: "delete"; id: string };

export interface SidecarHostMessage {
  type: "sidecar";
  highlights: SidecarHighlight[] | null;
}

/** More boxes than lines on any page: a highlight is one box per line. */
const MAX_RECTS = 2_000;
/** Larger than any real page, in points (PDF pages are at most 14,400 points). */
const MAX_COORDINATE = 1_000_000;
const MAX_PAGE = 1_000_000;
const MAX_TIME_LENGTH = 40;

/** A `sidecarWrite` from the viewer, if every field holds. */
export function parseSidecarWrite(
  message: Record<string, unknown>,
): SidecarWrite | undefined {
  const { load, op } = message;
  if (typeof load !== "number" || !Number.isSafeInteger(load) || load < 0) {
    return undefined;
  }
  if (op === "delete") {
    return isHighlightId(message.id)
      ? { type: "sidecarWrite", load, op, id: message.id }
      : undefined;
  }
  const highlight =
    op === "upsert" ? parseHighlight(message.highlight) : undefined;
  return highlight
    ? { type: "sidecarWrite", load, op: "upsert", highlight }
    : undefined;
}

/** A `sidecar` message from the host, as the viewer accepts it. */
export function parseSidecarHighlights(
  value: unknown,
): SidecarHighlight[] | null | undefined {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((item) => parseHighlight(item) ?? []);
}

/** One highlight, checked: an id, a page, boxes and bounded strings. */
export function parseHighlight(value: unknown): SidecarHighlight | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Record<string, unknown>;
  const { id, page, color, opacity } = fields;
  const segmentRects = parseRects(fields.segmentRects);
  const strings = parseStrings(fields);
  if (
    !isHighlightId(id) ||
    !isPage(page) ||
    !isColor(color) ||
    !isOpacity(opacity) ||
    !segmentRects ||
    !strings
  ) {
    return undefined;
  }
  return {
    id,
    page,
    subtype: "highlight",
    color,
    opacity,
    segmentRects,
    ...strings,
  };
}

function isPage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PAGE
  );
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isOpacity(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value <= 1;
}

function parseStrings(
  fields: Record<string, unknown>,
):
  | Pick<
      SidecarHighlight,
      "quote" | "contextBefore" | "contextAfter" | "created" | "modified"
    >
  | undefined {
  const limits = {
    quote: MAX_QUOTE_LENGTH,
    contextBefore: CONTEXT_LENGTH * 4,
    contextAfter: CONTEXT_LENGTH * 4,
    created: MAX_TIME_LENGTH,
    modified: MAX_TIME_LENGTH,
  };
  const result: Record<string, string> = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = fields[key];
    if (typeof value !== "string" || value.length > limit) {
      return undefined;
    }
    result[key] = value;
  }
  return result as ReturnType<typeof parseStrings>;
}

function parseRects(value: unknown): SegmentRect[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECTS) {
    return undefined;
  }
  const rects: SegmentRect[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return undefined;
    }
    const { x, y, w, h } = item as Record<string, unknown>;
    const numbers = [x, y, w, h];
    if (
      !numbers.every(
        (number) =>
          typeof number === "number" &&
          Number.isFinite(number) &&
          Math.abs(number) <= MAX_COORDINATE,
      ) ||
      (w as number) <= 0 ||
      (h as number) <= 0
    ) {
      return undefined;
    }
    rects.push({
      x: x as number,
      y: y as number,
      w: w as number,
      h: h as number,
    });
  }
  return rects;
}
