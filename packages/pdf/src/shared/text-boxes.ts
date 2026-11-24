import {
  isRotatedGeometryRun,
  type PageGeometryRun,
  type TextLayout,
} from "@embedpdf/engine-core/public";
import type { PageRect } from "./geometry";

/** A box in page space as `[left, top, right, bottom]`, Lumiere's `PageRect`. */
export type Bounds = PageRect;

/** The box of the character at `index` of `run`, hugging its shape. */
function glyphBounds(run: PageGeometryRun, index: number): Bounds | undefined {
  if (isRotatedGeometryRun(run)) {
    const glyph = run.glyphs[index];
    const quad =
      glyph && !glyph.space && !glyph.empty && (glyph.tight ?? glyph.loose);
    if (!quad) {
      return undefined;
    }
    const corners = [
      quad.upperLeft,
      quad.upperRight,
      quad.lowerLeft,
      quad.lowerRight,
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const glyph = run.glyphs[index];
  const box =
    glyph && !glyph.space && !glyph.empty && (glyph.tight ?? glyph.loose);
  return box
    ? [box.x, box.y, box.x + box.width, box.y + box.height]
    : undefined;
}

/**
 * The box of every character of a page, indexed as the page's characters
 * are; none for a space, a line break or anything else with no box. Boxes
 * hug the glyph's shape: the loose ones overlap the next table row.
 */
export function charBounds(layout: TextLayout): (Bounds | undefined)[] {
  const boxes = new Array<Bounds | undefined>(layout.charCount).fill(undefined);
  for (const run of layout.runs) {
    run.glyphs.forEach((_, offset) => {
      const box = glyphBounds(run, offset);
      // A box with no area is a character that is not drawn.
      if (box && box[2] > box[0] && box[3] > box[1]) {
        boxes[run.start + offset] = box;
      }
    });
  }
  return boxes;
}

/** The box of the character at `index`, or undefined where it has none. */
export function charBox(layout: TextLayout, index: number): Bounds | undefined {
  const run = layout.runs.find(
    (candidate) =>
      index >= candidate.start &&
      index < candidate.start + candidate.glyphs.length,
  );
  return run && glyphBounds(run, index - run.start);
}

/** The box around some boxes `{ x, y, width, height }`; undefined for none. */
export function unionBounds(
  rects: readonly { x: number; y: number; width: number; height: number }[],
): Bounds | undefined {
  let union: Bounds | undefined;
  for (const { x, y, width, height } of rects) {
    union = union
      ? [
          Math.min(union[0], x),
          Math.min(union[1], y),
          Math.max(union[2], x + width),
          Math.max(union[3], y + height),
        ]
      : [x, y, x + width, y + height];
  }
  return union;
}
