import type { EditorView } from "@codemirror/view";
import {
  parseTable,
  type CellPosition,
  type Table,
} from "../../markdown/tables/model";
import { editGroup } from "../document/api";
import type { RenderBlock } from "../livePreview/api";
import { indentRows, rowPrefix } from "./column-widths";
import type { TableEnvironment } from "./environment";

/** Rendered cells and their current source snapshot. It owns no selection. */
export class TableGrid {
  readonly table = document.createElement("table");
  readonly wrapper = document.createElement("div");
  /** Owns horizontal overflow for wide tables (not the note scroller). */
  readonly scroll: HTMLElement;
  cells: HTMLElement[][] = [];
  model: Table;
  private operationSequence = 0;

  constructor(
    readonly root: HTMLElement,
    public outer: EditorView,
    public block: RenderBlock,
    private readonly content: Pick<
      TableEnvironment,
      "disposeContent" | "renderContent"
    >,
  ) {
    this.model = parseTable(block.source)!;
    this.table.className = "markdown-rendered table-editor";
    this.table.setAttribute("aria-label", "Markdown table");
    // A wide table scrolls by itself, as in Obsidian, not the whole note.
    this.scroll = document.createElement("div");
    this.scroll.className = "table-scroll";
    this.wrapper.className = "table-wrapper";
    this.wrapper.append(this.table);
    this.scroll.append(this.wrapper);
    root.append(this.scroll);
  }

  /** Where the mounted table starts in the note (0 or the end when it is not). */
  start(): number {
    return this.outer.posAtDOM(this.root);
  }

  /**
   * Where this table's Markdown starts in the note, or undefined when the
   * note does not hold it there. A table with a grid selection stays active
   * after it scrolls out of view, and CodeMirror places a detached root at 0
   * or at the note's end: a write there would replace unrelated text.
   */
  locate(): number | undefined {
    if (!this.root.isConnected) {
      return undefined;
    }
    const from = this.start();
    const to = from + this.block.source.length;
    const doc = this.outer.state.doc;
    return to <= doc.length && doc.sliceString(from, to) === this.block.source
      ? from
      : undefined;
  }

  commandGroup(): string {
    return `table-command-${++this.operationSequence}`;
  }

  /**
   * Write `tableMarkdown` back as this block, every line after the first
   * indented like the table's rows, so a table in a list item stays in it.
   * Returns false, writing nothing, when the note no longer holds the table
   * where this grid is (see `locate`).
   */
  replace(tableMarkdown: string): boolean {
    const source = this.sourceFor(tableMarkdown);
    if (source === this.block.source) {
      return true;
    }
    const from = this.locate();
    if (from === undefined) {
      return false;
    }
    this.outer.dispatch({
      changes: { from, to: from + this.block.source.length, insert: source },
      annotations: editGroup.of(this.commandGroup()),
    });
    return true;
  }

  /** The block's source for `tableMarkdown` (see `replace`). */
  sourceFor(tableMarkdown: string): string {
    const prefix = rowPrefix(this.block.source);
    const table = tableMarkdown.split("\n").map((line, index) =>
      // Rows already written with the prefix (the source itself) keep it.
      index > 0 && line.startsWith(prefix) ? line.slice(prefix.length) : line,
    );
    return indentRows(table.join("\n"), prefix);
  }

  /** The table's Markdown, as in the note. */
  tableSource(): string {
    return this.block.source;
  }

  render(): void {
    this.disposeContent();
    this.table.replaceChildren();
    this.cells = [];
    const header = this.table.createTHead();
    const body = this.table.createTBody();
    this.model.rows.forEach((row, rowIndex) => {
      const element = document.createElement("tr");
      const cells = row.map((_cell, column) => {
        const cell = document.createElement(rowIndex === 0 ? "th" : "td");
        cell.dataset.row = String(rowIndex);
        cell.dataset.column = String(column);
        cell.setAttribute(
          "aria-label",
          `Row ${rowIndex + 1}, column ${column + 1}`,
        );
        const wrapper = document.createElement("div");
        wrapper.className = "table-cell-wrapper";
        const content = document.createElement("div");
        content.className = "table-cell-content";
        wrapper.append(content);
        cell.append(wrapper);
        element.append(cell);
        return cell;
      });
      this.cells.push(cells);
      (rowIndex === 0 ? header : body).append(element);
      cells.forEach((_cell, column) => this.display({ row: rowIndex, column }));
    });
  }

  refresh(active?: CellPosition, previous?: Table, force = false): void {
    this.cells.forEach((row, rowIndex) =>
      row.forEach((_cell, column) => {
        const position = { row: rowIndex, column };
        this.align(position);
        if (!sameCell(active, position)) {
          const prevCell = previous?.rows[rowIndex]?.[column];
          const nextCell = this.model.rows[rowIndex]?.[column];
          const offsetSensitive =
            nextCell !== undefined &&
            (nextCell.text.includes("[^") || nextCell.text.includes("^["));
          if (
            force ||
            !prevCell ||
            !nextCell ||
            prevCell.text !== nextCell.text ||
            offsetSensitive
          ) {
            this.display(position);
          }
        }
      }),
    );
  }

  display(position: CellPosition): void {
    const cell = this.model.rows[position.row]?.[position.column];
    const element = this.contentElement(position);
    if (!cell || !element) {
      return;
    }
    this.content.disposeContent(element);
    this.align(position);
    this.content.renderContent(element, cell.text, this.block.from + cell.from);
  }

  disposeContent(): void {
    for (const cell of this.table.querySelectorAll<HTMLElement>(
      ".table-cell-content",
    )) {
      this.content.disposeContent(cell);
    }
  }

  contentElement(position: CellPosition): HTMLElement | undefined {
    return (
      this.cells[position.row]?.[position.column]?.querySelector<HTMLElement>(
        ".table-cell-content",
      ) ?? undefined
    );
  }

  private align(position: CellPosition): void {
    const cell = this.cells[position.row]?.[position.column];
    if (cell) {
      const alignment = this.model.alignments[position.column] ?? "left";
      cell.style.textAlign = alignment;
      cell.setAttribute("align", alignment);
    }
  }

  position(target: EventTarget | null): CellPosition | undefined {
    const cell =
      target instanceof Element
        ? target.closest<HTMLElement>("td[data-row], th[data-row]")
        : null;
    if (!cell || !this.table.contains(cell)) {
      return undefined;
    }
    return {
      row: Number(cell.dataset.row),
      column: Number(cell.dataset.column),
    };
  }
}

export function sameCell(
  left: CellPosition | undefined,
  right: CellPosition,
): boolean {
  return left?.row === right.row && left.column === right.column;
}
