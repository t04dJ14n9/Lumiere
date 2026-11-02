import type { TableOperation } from "../../markdown/tables/operations";
/** Minimum rendered column width in CSS pixels (matches cell min-width). */
export const MIN_COLUMN_WIDTH = 60;

/**
 * A column's width set by dragging its border, in CSS pixels; `undefined`
 * while its content sizes it. Widths live with the open table only and are
 * never written to the note: Obsidian keeps no widths for a Markdown table
 * (it has no column resizing), and GFM has no syntax for them.
 */
export type ColumnWidth = number | undefined;

export type ColumnWidthOp =
  | { type: "insert"; index: number }
  | { type: "delete"; from: number; to: number }
  | { type: "move"; from: number; to: number; destination: number }
  | { type: "duplicate"; from: number; to: number };

/**
 * What goes before each row of a table after its first line: a list item's
 * indent. The block starts at the header's first character, so the header
 * has none.
 */
export function rowPrefix(source: string): string {
  const second = source.split("\n")[1] ?? "";
  return /^[ \t]*/.exec(second)![0];
}

/** `source` with `prefix` before every line after the first. */
export function indentRows(source: string, prefix: string): string {
  return prefix ? source.split("\n").join(`\n${prefix}`) : source;
}

/**
 * How far from a column's right border a press resizes the column, in CSS
 * px. Three pixels in, a press is the cell's again: it opens the cell at the
 * end of its text (or, in the next cell, at the start).
 */
export const COLUMN_EDGE_REACH = 2;

/**
 * The column whose right border `x` is on, within `reach` (the nearest, if
 * two are); `rights` are the columns' right borders, left to right.
 */
export function columnEdgeAt(
  rights: readonly number[],
  x: number,
  reach = COLUMN_EDGE_REACH,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  rights.forEach((right, column) => {
    const distance = Math.abs(x - right);
    if (distance <= reach && distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  });
  return best;
}

export function applyColumnWidth(
  widths: number[],
  column: number,
  next: number,
  min = MIN_COLUMN_WIDTH,
): number[] {
  const result = widths.slice();
  result[column] = Math.max(min, Math.round(next));
  return result;
}

/** Keep widths aligned when columns are inserted, removed or moved. */
export function remapColumnWidths(
  widths: ColumnWidth[] | undefined,
  operation: ColumnWidthOp,
): ColumnWidth[] | undefined {
  if (!widths) {
    return undefined;
  }
  const next = widths.slice();
  if (operation.type === "insert") {
    next.splice(operation.index, 0, undefined);
  } else if (operation.type === "delete") {
    next.splice(operation.from, operation.to - operation.from + 1);
  } else if (operation.type === "duplicate") {
    next.splice(
      operation.to + 1,
      0,
      ...next.slice(operation.from, operation.to + 1),
    );
  } else if (operation.type === "move") {
    const moved = next.splice(
      operation.from,
      operation.to - operation.from + 1,
    );
    next.splice(operation.destination, 0, ...moved);
  }
  return next;
}

/** Remap widths for a table structural operation (column axis only). */
export function widthsAfterOperation(
  widths: ColumnWidth[] | undefined,
  operation: TableOperation,
): ColumnWidth[] | undefined {
  if (!("axis" in operation) || operation.axis !== "column") {
    return widths;
  }
  if (operation.type === "insert") {
    return remapColumnWidths(widths, {
      type: "insert",
      index: operation.index,
    });
  }
  if (operation.type === "move") {
    return remapColumnWidths(widths, {
      type: "move",
      from: operation.from,
      to: operation.to,
      destination: operation.destination,
    });
  }
  if (operation.type === "delete" || operation.type === "duplicate") {
    return remapColumnWidths(widths, {
      type: operation.type,
      from: operation.from,
      to: operation.to,
    });
  }
  return widths;
}
