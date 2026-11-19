import {
  rectangle,
  type CellPosition,
  type CellRange,
} from "../../markdown/tables/model";
import type { TableOperation } from "../../markdown/tables/operations";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/** The table Insert Table adds: two empty columns, as Obsidian's. */
const NEW_TABLE = "|     |     |\n| --- | --- |\n|     |     |";

/**
 * Insert Table, as in Obsidian: a new table after the line the selection
 * starts on, a blank line between them unless that line is empty, and the
 * caret at its start.
 */
export function insertTable(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.from);
  const before = line.length ? "\n\n" : "\n";
  return {
    changes: { from: line.to, insert: `${before}${NEW_TABLE}\n` },
    selection: { anchor: line.to + before.length },
    userEvent: "input",
  };
}

/**
 * The operation a `Table: …` command applies to the selected cells (or the
 * open cell): every selected row or column, as the context menu does.
 */
export function tableOperation(
  id: string,
  target: CellPosition | CellRange,
): TableOperation | undefined {
  const range = "anchor" in target ? target : { anchor: target, head: target };
  const area = rectangle(range);
  const alignment = alignmentOperation(id, area.left, area.right);
  if (alignment) {
    return alignment;
  }
  if (id === "sort-ascending" || id === "sort-descending") {
    return {
      type: "sort",
      column: range.head.column,
      direction: id === "sort-ascending" ? "ascending" : "descending",
    };
  }
  const axis = id.includes("row") ? "row" : "column";
  return axis === "row"
    ? lineOperation(id, axis, { from: area.top, to: area.bottom })
    : lineOperation(id, axis, { from: area.left, to: area.right });
}

/** Insert beside, delete, duplicate or move the rows or columns `from`…`to`. */
function lineOperation(
  id: string,
  axis: "row" | "column",
  { from, to }: { from: number; to: number },
): TableOperation | undefined {
  if (id.startsWith("insert-")) {
    const after = id.endsWith("below") || id.endsWith("right");
    // As in Obsidian, a new column is aligned as the one it is added beside.
    return {
      type: "insert",
      axis,
      index: after ? to + 1 : from,
      ...(axis === "column" && { alignAs: after ? to : from }),
    };
  }
  if (id.startsWith("delete-") || id.startsWith("duplicate-")) {
    const type = id.startsWith("delete-") ? "delete" : "duplicate";
    return { type, axis, from, to };
  }
  if (id.startsWith("move-")) {
    const back = id.endsWith("up") || id.endsWith("left");
    return {
      type: "move",
      axis,
      from,
      to,
      destination: Math.max(0, from + (back ? -1 : 1)),
    };
  }
  return undefined;
}

function alignmentOperation(
  id: string,
  from: number,
  to: number,
): TableOperation | undefined {
  if (id.startsWith("align-")) {
    const alignment = id.slice(6);
    if (
      alignment === "left" ||
      alignment === "center" ||
      alignment === "right"
    ) {
      return { type: "align", from, to, alignment };
    }
  }
  return undefined;
}
