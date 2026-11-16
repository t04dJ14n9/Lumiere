import {
  parseTable,
  rangeTexts,
  rectangle,
  serializeTable,
  type CellRange,
  type Table,
} from "./model";
import { splitTabSeparated } from "./tab-separated";

/** Tab-separated cells, as spreadsheets copy them. */
export function copyCells(table: Table, range: CellRange): string {
  return rangeTexts(table, range)
    .map((row) => row.map((text) => text.replace(/\\\|/g, "|")).join("\t"))
    .join("\n");
}

/** Plain cell texts for a range (pipes unescaped), as Obsidian `obsidian/table` rows. */
export function copyCellsRows(table: Table, range: CellRange): string[][] {
  return rangeTexts(table, range).map((row) =>
    row.map((text) => text.replace(/\\\|/g, "|")),
  );
}

/**
 * Markdown table fragment for the selection (first row as header + alignment
 * line), matching Obsidian `getTableString` / `text/markdown` on copy.
 */
export function copyCellsMarkdown(table: Table, range: CellRange): string {
  const area = rectangle(range);
  const rows = copyCellsRows(table, range);
  const alignments = table.alignments.slice(area.left, area.right + 1);
  return serializeTable(rows, alignments);
}

/** Simple HTML table for `text/html` (Obsidian uses markdown→HTML; we emit a table). */
export function copyCellsHtml(table: Table, range: CellRange): string {
  const rows = copyCellsRows(table, range);
  const escape = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const body = rows
    .map((row, index) => {
      const tag = index === 0 ? "th" : "td";
      return (
        "<tr>" +
        row.map((cell) => `<${tag}>${escape(cell)}</${tag}>`).join("") +
        "</tr>"
      );
    })
    .join("");
  return `<!-- lumiere-table -->\n<table>\n${body}\n</table>`;
}

/** Obsidian-compatible structured payload (`obsidian/table`). */
export function copyCellsObsidian(
  table: Table,
  range: CellRange,
): { rows: string[][]; alignment: string[] } {
  const area = rectangle(range);
  return {
    rows: copyCellsRows(table, range),
    alignment: table.alignments
      .slice(area.left, area.right + 1)
      .map((alignment) => alignment ?? ""),
  };
}

/**
 * Parse a markdown table fragment into cell rows (skips the alignment line).
 * Rows are read as the editor reads them: escaped pipes stay in their cell,
 * short rows are padded, and only a blank line ends the table.
 */
export function pastedMarkdownCells(text: string): string[][] {
  const table = parseTable(text.replace(/\r\n?/g, "\n").trim());
  if (!table) {
    return [[text]];
  }
  return table.rows.map((row) =>
    row.map((cell) => cell.text.replace(/\\\|/g, "|")),
  );
}

/** Split tab-separated clipboard text into rows of cell values. */
export function pastedCells(text: string): string[][] {
  return splitTabSeparated(text);
}
