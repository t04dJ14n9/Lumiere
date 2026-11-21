import { rowTexts, serializeTable, type Table } from "./model";

export type Axis = "row" | "column";
export type TableOperation =
  | {
      type: "insert";
      axis: Axis;
      index: number;
      /** The column whose alignment a new column takes. */
      alignAs?: number;
    }
  | { type: "delete" | "duplicate"; axis: Axis; from: number; to: number }
  | { type: "move"; axis: Axis; from: number; to: number; destination: number }
  | {
      type: "align";
      from: number;
      to: number;
      alignment: "left" | "center" | "right";
    }
  | {
      type: "sort";
      column: number;
      direction: "ascending" | "descending";
      /**
       * The text each row's cell in the column shows, by row index (the
       * header's included), as Obsidian sorts by. Without it, or for a row it
       * lacks, the cell's Markdown is compared.
       */
      shown?: readonly string[];
    };

/** Every structural command produces one complete Markdown edit. */
export function operateTable(table: Table, operation: TableOperation): string {
  // Rows carry their surplus cells, so row edits move them with the row.
  const rows = rowTexts(table);
  const alignments = [...table.alignments];
  if (operation.type === "align") {
    for (let column = operation.from; column <= operation.to; column++) {
      alignments[column] = operation.alignment;
    }
  } else if (operation.type === "sort") {
    sortBody(rows, operation);
  } else {
    const edit = <T>(items: T[], empty: () => T): void => {
      if (operation.type === "insert") {
        items.splice(operation.index, 0, empty());
      } else if (operation.type === "duplicate") {
        items.splice(
          operation.to + 1,
          0,
          ...items.slice(operation.from, operation.to + 1),
        );
      } else if (operation.type === "delete") {
        items.splice(operation.from, operation.to - operation.from + 1);
      } else if (operation.type === "move") {
        const moved = items.splice(
          operation.from,
          operation.to - operation.from + 1,
        );
        items.splice(operation.destination, 0, ...moved);
      }
    };
    if (operation.axis === "row") {
      edit(rows, () => Array<string>(alignments.length).fill(""));
    } else {
      const alignAs =
        operation.type === "insert" ? operation.alignAs : undefined;
      edit(alignments, () =>
        alignAs === undefined ? null : (table.alignments[alignAs] ?? null),
      );
      // Column edits apply to the table's columns only; the surplus follows.
      const width = table.alignments.length;
      rows.forEach((row, index) => {
        const columns = row.slice(0, width);
        edit(columns, () => "");
        rows[index] = [...columns, ...row.slice(width)];
      });
    }
  }
  return rows.length && alignments.length
    ? serializeTable(rows, alignments)
    : "";
}

/**
 * Sorts the rows below the header by one column's shown text, numbers by
 * their value, with Obsidian's collator; ties keep their order.
 */
function sortBody(
  rows: string[][],
  { column, direction, shown }: Extract<TableOperation, { type: "sort" }>,
): void {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const sign = direction === "ascending" ? 1 : -1;
  const body = rows
    .slice(1)
    .map((row, index) => ({
      row,
      key: shown?.[index + 1] ?? row[column] ?? "",
    }))
    .sort((left, right) => sign * collator.compare(left.key, right.key))
    .map(({ row }) => row);
  rows.splice(1, rows.length - 1, ...body);
}
