import type { CellPosition } from "../../markdown/tables/model";
import type { Axis } from "../../markdown/tables/operations";
import type { PointerPoint } from "../../webview/ui/edge-scroll";

/** Resolve physical coordinates, including RTL columns and points past an edge. */
export function nearestEntry(
  entries: Iterable<Element>,
  axis: Axis,
  point: PointerPoint,
): number {
  const horizontal = axis === "column";
  const position = horizontal ? point.x : point.y;
  let nearest = Infinity;
  let selected = -1;
  let index = 0;
  for (const entry of entries) {
    const bounds = entry.getBoundingClientRect();
    const from = horizontal ? bounds.left : bounds.top;
    const to = horizontal ? bounds.right : bounds.bottom;
    const distance = Math.max(from - position, position - to, 0);
    if (distance < nearest) {
      nearest = distance;
      selected = index;
    }
    index++;
  }
  return selected;
}

/**
 * `nearestEntry` for rows laid out top to bottom, reading the layout of a
 * few rows instead of every one: a drag over a long table asks on each
 * pointer move.
 */
export function nearestRow(rows: ArrayLike<Element>, y: number): number {
  if (rows.length === 0) {
    return -1;
  }
  const bounds = (index: number) => rows[index]!.getBoundingClientRect();
  // The first row whose bottom is at or below the point, else the last.
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bounds(middle).bottom < y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const distance = (index: number) => {
    const { top, bottom } = bounds(index);
    return Math.max(top - y, y - bottom, 0);
  };
  // Only the row above can be as near; a tie goes to it, as in nearestEntry.
  return low > 0 && distance(low - 1) <= distance(low) ? low - 1 : low;
}

export function cellAtPoint(
  table: HTMLTableElement,
  point: PointerPoint,
): CellPosition | undefined {
  const row = nearestRow(table.rows, point.y);
  const cells = table.rows[row]?.cells;
  const column = cells ? nearestEntry(cells, "column", point) : -1;
  return row < 0 || column < 0 ? undefined : { row, column };
}

function pointInBounds(point: PointerPoint, bounds: DOMRect): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

/**
 * Cell under the pointer only when the hit target is actually inside a cell.
 * Unlike {@link cellAtPoint}, points past the table edge do not clamp to the
 * nearest row/column — used so a text drag that leaves a cell is not converted
 * into a grid/column selection.
 *
 * Row/column grips (`.table-handle`) are absolutely positioned outside the
 * cell box but live inside `.table-cell-wrapper`, so DOM ancestry alone would
 * falsely claim the owning cell. Reject handle hits and require the point to
 * lie in the resolved cell's layout box.
 */
export function cellUnderPoint(
  table: HTMLTableElement,
  point: PointerPoint,
): CellPosition | undefined {
  const node =
    typeof document !== "undefined"
      ? document.elementFromPoint(point.x, point.y)
      : null;
  if (!node || typeof (node as Element).closest !== "function") {
    return undefined;
  }
  const el = node as Element;
  // Grips / chrome inside the wrapper must not count as cell content.
  if (el.closest(".table-handle")) {
    return undefined;
  }
  const cell = el.closest<HTMLElement>("td[data-row], th[data-row]");
  if (!cell || !table.contains(cell)) {
    return undefined;
  }
  if (!pointInBounds(point, cell.getBoundingClientRect())) {
    return undefined;
  }
  return {
    row: Number(cell.dataset.row),
    column: Number(cell.dataset.column),
  };
}
