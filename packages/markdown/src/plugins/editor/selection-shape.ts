/**
 * The shape of the drawn selection, as pure geometry: which rectangles join
 * into one, which of their corners round, and where a list line's tint
 * starts. selection-layer.ts measures the rectangles; this decides how they
 * look, so it is testable without a DOM.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The corner radius in selection.css, which also bounds a "covered" corner. */
export const SELECTION_RADIUS = 4;

/** Measured edges of adjacent rows and runs differ by subpixel rounding. */
const TOUCH = 1;

/** One rounded selection rectangle and the corners another one covers. */
export interface ShapedBox extends Box {
  /** `tl`, `tr`, `bl`, `br`: corners that stay square. */
  square: string[];
}

/**
 * Join runs on the same row that touch: a line's text and the stub for its
 * line break are drawn as two rectangles but read as one band, and rounding
 * them separately would pinch the band where they meet.
 */
export function joinTouchingRuns(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: Box[] = [];
  for (const box of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.top - box.top) < TOUCH &&
      Math.abs(last.height - box.height) < TOUCH &&
      box.left <= last.left + last.width + TOUCH
    ) {
      const right = Math.max(last.left + last.width, box.left + box.width);
      last.width = right - last.left;
    } else {
      out.push({ ...box });
    }
  }
  return out;
}

/** Whether `other` sits directly on `edge` (the top or bottom) of `box`. */
function touches(box: Box, other: Box, edge: "top" | "bottom"): boolean {
  return edge === "top"
    ? Math.abs(other.top + other.height - box.top) < TOUCH
    : Math.abs(box.top + box.height - other.top) < TOUCH;
}

/** Whether `other` spans at least a radius inward from `box`'s left or right corner. */
function coversCorner(box: Box, other: Box, side: "left" | "right"): boolean {
  const right = box.left + box.width;
  const otherRight = other.left + other.width;
  return side === "left"
    ? other.left <= box.left + 0.5 && otherRight >= box.left + SELECTION_RADIUS
    : otherRight >= right - 0.5 && other.left <= right - SELECTION_RADIUS;
}

/**
 * Round each rectangle's corners except where a rectangle on the row above
 * or below continues past it, so a multi-line selection reads as one block
 * with rounded outer corners, like VS Code's and Obsidian's.
 */
export function shapeSelection(boxes: Box[]): ShapedBox[] {
  const joined = joinTouchingRuns(boxes);
  return joined.map((box) => {
    const square: string[] = [];
    for (const [edge, prefix] of [
      ["top", "t"],
      ["bottom", "b"],
    ] as const) {
      const neighbours = joined.filter(
        (other) => other !== box && touches(box, other, edge),
      );
      if (neighbours.some((other) => coversCorner(box, other, "left"))) {
        square.push(`${prefix}l`);
      }
      if (neighbours.some((other) => coversCorner(box, other, "right"))) {
        square.push(`${prefix}r`);
      }
    }
    return { ...box, square };
  });
}

/** A list item's marker after its indentation: `-`, `*`, `+`, `1.` or `1)`. */
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * How far into a list line its tint starts: past the indentation, at the
 * marker. Live Preview draws that indentation as indent guides, not text, so
 * tinting it would paint a block in front of the marker. Other lines start
 * at 0.
 */
export function listIndentEnd(lineText: string): number {
  return LIST_ITEM.exec(lineText)?.[1]?.length ?? 0;
}

/** Where a selection's caret sits, in the same coordinates as the boxes. */
export interface CaretPoint {
  x: number;
  y: number;
}

/**
 * Square the corners on the side where a caret meets the selection, as VS
 * Code does: a rounded corner beside the caret leaves a notch between the
 * caret and the tint. `tolerance` covers a Vim visual selection, which tints
 * the character under the caret, so the caret can sit up to one character
 * inside the box's edge.
 */
export function squareAtCarets(
  boxes: ShapedBox[],
  carets: CaretPoint[],
  tolerance: number,
): ShapedBox[] {
  return boxes.map((box) => {
    const square = new Set(box.square);
    const right = box.left + box.width;
    for (const caret of carets) {
      if (caret.y < box.top || caret.y > box.top + box.height) {
        continue;
      }
      if (Math.abs(caret.x - box.left) <= tolerance) {
        square.add("tl").add("bl");
      }
      if (Math.abs(caret.x - right) <= tolerance) {
        square.add("tr").add("br");
      }
    }
    return { ...box, square: [...square] };
  });
}
