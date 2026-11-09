/**
 * Version 1 of the annotation file held EmbedPDF 2's transfer items:
 * `{ version: 1, annotations: [{ annotation, ctx }] }`, with dates and bytes
 * tagged (`$date`, `$bytes`). EmbedPDF 3 reads annotations as bundles, so an
 * old file is converted to one when it is opened; the next save writes the
 * new format (`annotation-store`).
 *
 * A converted annotation is a description a create understands (the import
 * checks it like any create), not a faithful read: what the old kinds drew
 * is rebuilt from their data, and the engine bakes its own appearance.
 */
import type { AnnotationBundle } from "@embedpdf/engine-core/public";

/** An annotation as the version 1 file held it, enum values as numbers. */
export interface LegacyAnnotation {
  annotation: { id: string; pageIndex: number; type: number } & Record<
    string,
    unknown
  >;
  ctx?: unknown;
}

export interface LegacyConversion {
  bundle: AnnotationBundle;
  /** Annotations of a kind the viewer does not make, or without what they need: left out. */
  skipped: number;
}

type Fields = Record<string, unknown>;
type Point = { x: number; y: number };

// The enums of EmbedPDF 2's models, whose numbering EmbedPDF 3's names follow.
const SUBTYPES: Record<number, string> = {
  1: "text",
  3: "free-text",
  4: "line",
  5: "square",
  6: "circle",
  7: "polygon",
  8: "polyline",
  9: "highlight",
  10: "underline",
  11: "squiggly",
  12: "strikeout",
  13: "stamp",
  15: "ink",
};
const MARKUP = new Set(["highlight", "underline", "squiggly", "strikeout"]);
const FONTS = [
  "courier",
  "courier-bold",
  "courier-bold-oblique",
  "courier-oblique",
  "helvetica",
  "helvetica-bold",
  "helvetica-bold-oblique",
  "helvetica-oblique",
  "times-roman",
  "times-bold",
  "times-bold-italic",
  "times-italic",
  "symbol",
  "zapf-dingbats",
];
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];
const LINE_ENDINGS = [
  "none",
  "square",
  "circle",
  "diamond",
  "open-arrow",
  "closed-arrow",
  "butt",
  "r-open-arrow",
  "r-closed-arrow",
  "slash",
];
const NOTE_ICONS = [
  "comment",
  "key",
  "note",
  "help",
  "new-paragraph",
  "paragraph",
  "insert",
];
const ALIGNMENTS = ["left", "center", "right"];
const VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

/** The bundle for the annotations of an old file. Pages are placeholders: import them `by-position`. */
export async function legacyToBundle(
  items: readonly LegacyAnnotation[],
): Promise<LegacyConversion> {
  const rows: Array<{ data: Fields; appearance?: Uint8Array }> = [];
  for (const item of items) {
    const row = convertAnnotation(item, rows.length + 1);
    if (row) {
      rows.push(row);
    }
  }
  const resources: Record<string, Uint8Array> = {};
  const bundleItems = [];
  for (const row of rows) {
    const named: Record<string, string> = {};
    if (row.appearance) {
      const id = await resourceId(row.appearance);
      resources[id] = row.appearance;
      named.appearance = id;
    }
    bundleItems.push({ data: row.data, resources: named });
  }
  const indexes = [
    ...new Set(rows.map((row) => pageOf(row.data).objectNumber - 1)),
  ].sort((a, b) => a - b);
  const bundle = {
    format: "embedpdf/annotations",
    version: 1,
    pages: indexes.map((index) => ({
      page: placeholderPage(index),
      position: index,
      size: { width: 0, height: 0 },
    })),
    items: bundleItems,
    resources,
  };
  return {
    bundle: bundle as unknown as AnnotationBundle,
    skipped: items.length - rows.length,
  };
}

function placeholderPage(index: number): {
  kind: "objectNumber";
  objectNumber: number;
} {
  return { kind: "objectNumber", objectNumber: index + 1 };
}

function pageOf(data: Fields): { objectNumber: number } {
  return (data.ref as { page: { objectNumber: number } }).page;
}

function convertAnnotation(
  item: LegacyAnnotation,
  number: number,
): { data: Fields; appearance?: Uint8Array } | undefined {
  const { annotation } = item;
  const subtype = SUBTYPES[annotation.type];
  if (!subtype) {
    return undefined;
  }
  const page = placeholderPage(annotation.pageIndex);
  // An import reads a create's fields from the item and the engine's own from
  // nowhere, so those are left out; `ref` only has to be unique and name its page.
  const data: Fields = {
    subtype,
    ref: { kind: "objectNumber", page, objectNumber: number },
    ...baseFields(annotation),
  };
  const specific = subtypeFields(subtype, annotation);
  if (!specific) {
    return undefined;
  }
  Object.assign(data, specific);
  if (subtype !== "stamp") {
    return { data };
  }
  const appearance = stampImage(item.ctx);
  return appearance ? { data, appearance } : undefined;
}

/**
 * What every kind shares: its name, text, author, dates and blend mode. An
 * import restores the attribution fields as the item has them, so each is
 * there, `null` when the old file did not know it.
 */
function baseFields(annotation: Fields): Fields {
  const fields: Fields = {
    nm: annotation.id,
    author: typeof annotation.author === "string" ? annotation.author : null,
    createdAt: isoDate(annotation.created),
    modifiedAt: isoDate(annotation.modified),
    userId: null,
    createdBy: null,
    modifiedBy: null,
    groupId: null,
  };
  copyString(fields, "contents", annotation.contents);
  copyString(fields, "subject", annotation.subject);
  const blend = BLEND_MODES[annotation.blendMode as number];
  if (blend) {
    fields.blendMode = blend;
  }
  return fields;
}

function subtypeFields(
  subtype: string,
  annotation: Fields,
): Fields | undefined {
  if (MARKUP.has(subtype)) {
    return markupFields(annotation);
  }
  switch (subtype) {
    case "ink":
      return inkFields(annotation);
    case "line":
      return lineFields(annotation);
    case "polygon":
    case "polyline":
      return vertexFields(subtype, annotation);
    case "square":
    case "circle":
      return withBox(annotation, shapeStyle(annotation));
    case "free-text":
      return withBox(annotation, freeTextFields(annotation));
    case "text":
      return withBox(annotation, noteFields(annotation));
    default:
      return withBox(annotation, stampFields(annotation));
  }
}

function markupFields(annotation: Fields): Fields | undefined {
  const rects = Array.isArray(annotation.segmentRects)
    ? annotation.segmentRects.map(boxOf)
    : [];
  if (rects.length === 0 || rects.some((rect) => !rect)) {
    return undefined;
  }
  const quadPoints = (rects as Box[]).map(({ x, y, width, height }) => ({
    upperLeft: { x, y },
    upperRight: { x: x + width, y },
    lowerLeft: { x, y: y + height },
    lowerRight: { x: x + width, y: y + height },
  }));
  return { quadPoints, ...strokeColor(annotation), ...opacity(annotation) };
}

function inkFields(annotation: Fields): Fields | undefined {
  const strokes = Array.isArray(annotation.inkList)
    ? annotation.inkList.map((stroke) => points((stroke as Fields)?.points))
    : [];
  if (strokes.length === 0 || strokes.some((stroke) => !stroke)) {
    return undefined;
  }
  return {
    inkList: strokes,
    ...strokeColor(annotation),
    ...opacity(annotation),
    ...positive(annotation, "strokeWidth"),
  };
}

function lineFields(annotation: Fields): Fields | undefined {
  const { start, end } = (annotation.linePoints ?? {}) as Fields;
  if (!isPoint(start) || !isPoint(end)) {
    return undefined;
  }
  return {
    linePoints: { start: pointOf(start), end: pointOf(end) },
    ...lineEndings(annotation),
    ...shapeStyle(annotation),
  };
}

function vertexFields(subtype: string, annotation: Fields): Fields | undefined {
  const vertices = points(annotation.vertices);
  if (!vertices || vertices.length < (subtype === "polygon" ? 3 : 2)) {
    return undefined;
  }
  return {
    vertices,
    ...(subtype === "polyline" ? lineEndings(annotation) : {}),
    ...shapeStyle(annotation),
  };
}

/** A shape's stroke and fill. EmbedPDF 2's `color` was the fill (or "transparent"). */
function shapeStyle(annotation: Fields): Fields {
  const fields: Fields = opacity(annotation);
  copyColor(fields, "color", annotation.strokeColor);
  copyColor(fields, "interiorColor", annotation.color);
  Object.assign(fields, positive(annotation, "strokeWidth"));
  if (annotation.strokeStyle === 2) {
    fields.borderStyle = "dashed";
    const dashes = annotation.strokeDashArray;
    if (Array.isArray(dashes) && dashes.length > 0) {
      fields.dashArray = dashes;
    }
  }
  const cloud = annotation.cloudyBorderIntensity;
  if (typeof cloud === "number" && cloud > 0) {
    fields.cloudyIntensity = cloud;
  }
  return fields;
}

function lineEndings(annotation: Fields): Fields {
  const { start, end } = (annotation.lineEndings ?? {}) as Fields;
  const named = [start, end].map((ending) => LINE_ENDINGS[ending as number]);
  return named[0] && named[1]
    ? { lineEndings: { start: named[0], end: named[1] } }
    : {};
}

function freeTextFields(annotation: Fields): Fields {
  const fields: Fields = {};
  const font = FONTS[annotation.fontFamily as number];
  if (font) {
    fields.fontFamily = font;
  }
  Object.assign(fields, positive(annotation, "fontSize"));
  copyColor(fields, "fontColor", annotation.fontColor);
  const align = ALIGNMENTS[annotation.textAlign as number];
  if (align) {
    fields.textAlign = align;
  }
  const vertical = VERTICAL_ALIGNMENTS[annotation.verticalAlign as number];
  if (vertical) {
    fields.verticalAlign = vertical;
  }
  Object.assign(fields, opacity(annotation));
  copyColor(
    fields,
    "interiorColor",
    annotation.backgroundColor ?? annotation.color,
  );
  copyColor(fields, "color", annotation.strokeColor);
  Object.assign(fields, positive(annotation, "strokeWidth"));
  return fields;
}

function noteFields(annotation: Fields): Fields {
  return {
    icon:
      NOTE_ICONS[(annotation.name ?? annotation.icon) as number] ?? "comment",
    ...strokeColor(annotation),
    ...opacity(annotation),
  };
}

function stampFields(annotation: Fields): Fields {
  const fields: Fields = {};
  if (typeof annotation.name === "string") {
    fields.name = annotation.name;
  }
  return fields;
}

/** The image a stamp was made from, which EmbedPDF 3 keeps as the stamp's drawing. */
function stampImage(ctx: unknown): Uint8Array | undefined {
  const { data, appearance } = (ctx ?? {}) as Fields;
  const bytes = data ?? appearance;
  return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : undefined;
}

type Box = { x: number; y: number; width: number; height: number };

function boxOf(rect: unknown): Box | undefined {
  const { origin, size } = (rect ?? {}) as Fields;
  if (!isPoint(origin) || typeof size !== "object" || size === null) {
    return undefined;
  }
  const { width, height } = size as Fields;
  if (!isNumber(width) || !isNumber(height) || width < 0 || height < 0) {
    return undefined;
  }
  return { ...pointOf(origin), width, height };
}

/** A box kind (shape, text, stamp) needs its rectangle. */
function withBox(annotation: Fields, fields: Fields): Fields | undefined {
  const rect = boxOf(annotation.rect);
  return rect ? { rect, ...fields } : undefined;
}

/** The colour of a mark: EmbedPDF 2 wrote it as `strokeColor` and as `color`. */
function strokeColor(annotation: Fields): Fields {
  const fields: Fields = {};
  copyColor(fields, "color", annotation.strokeColor ?? annotation.color);
  return fields;
}

function opacity(annotation: Fields): Fields {
  const value = annotation.opacity;
  return isNumber(value) && value >= 0 && value <= 1 ? { opacity: value } : {};
}

function positive(annotation: Fields, name: string): Fields {
  const value = annotation[name];
  return isNumber(value) && value > 0 ? { [name]: value } : {};
}

function copyColor(fields: Fields, name: string, value: unknown): void {
  if (typeof value === "string" && HEX_COLOR.test(value)) {
    fields[name] = value;
  }
}

function copyString(fields: Fields, name: string, value: unknown): void {
  if (typeof value === "string" && value !== "") {
    fields[name] = value;
  }
}

function isoDate(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  const { x, y } = (value ?? {}) as Fields;
  return isNumber(x) && isNumber(y);
}

function pointOf(point: Point): Point {
  return { x: point.x, y: point.y };
}

function points(value: unknown): Point[] | undefined {
  return Array.isArray(value) && value.every(isPoint)
    ? value.map(pointOf)
    : undefined;
}

async function resourceId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}
