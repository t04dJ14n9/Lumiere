import type { CellPosition, Table } from "../../markdown/tables/model";
import type { TableOperation } from "../../markdown/tables/operations";

type SortOperation = Extract<TableOperation, { type: "sort" }>;

/** What a sort reads from a table's cells. */
export interface ShownCells {
  /**
   * The cell text the cell's element shows a finished rendering of, if any.
   * Not the cell being edited (its element holds the cell editor and its
   * Markdown), nor a cell still rendering.
   */
  renderedSource(position: CellPosition): string | undefined;
  /** The text the cell's element reads as (its `innerText`). */
  elementText(position: CellPosition): string;
  /** The text `markdown` shows once rendered as a cell's text. */
  renderText(markdown: string, position: CellPosition): Promise<string>;
}

/**
 * Each row's cell in `column` as the reader sees it (the rendered text),
 * which Obsidian sorts by. Every key is a rendering of the cell's current
 * Markdown, whichever cell is being edited: a cell that shows one gives its
 * text, any other is rendered for the sort.
 */
export function shownColumn(
  table: Table,
  column: number,
  cells: ShownCells,
): Promise<string[]> {
  return Promise.all(
    table.rows.map((row, index) => {
      const text = row[column]?.text;
      if (text === undefined) {
        return "";
      }
      const position = { row: index, column };
      return cells.renderedSource(position) === text
        ? cells.elementText(position)
        : cells.renderText(text, position);
    }),
  );
}

/**
 * `operation` with the text each row's cell shows. Rendering a cell for its
 * key may wait; if the table is edited meanwhile, the keys no longer
 * describe its rows: undefined then, and the table is left as it is.
 */
export async function withShownText(
  grid: {
    tableSource(): string;
    shownTexts(column: number): Promise<string[]>;
  },
  operation: SortOperation,
): Promise<SortOperation | undefined> {
  const source = grid.tableSource();
  const shown = await grid.shownTexts(operation.column);
  return grid.tableSource() === source ? { ...operation, shown } : undefined;
}
