import type { EditorView } from "@codemirror/view";
import type { CellPosition, Table } from "../../markdown/tables/model";
import { parsedTable } from "../../markdown/tables/parsed";
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
      "disposeContent" | "renderContent" | "renderedSource" | "moveContent"
    >,
  ) {
    this.model = parsedTable(block.source)!;
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
    return this.holdsSource(from) ? from : undefined;
  }

  /**
   * Where cell rendering takes source lines from. The block's start is exact
   * after each widget update, but CodeMirror keeps a widget whose source did
   * not change, so an edit above the table leaves it stale; the mounted
   * root's position is used then. Never past the note's end.
   */
  private renderStart(): number {
    let from = this.block.from;
    if (!this.holdsSource(from) && this.root.isConnected) {
      from = this.start();
    }
    return Math.max(0, Math.min(from, this.outer.state.doc.length));
  }

  private holdsSource(from: number): boolean {
    const to = from + this.block.source.length;
    const doc = this.outer.state.doc;
    return (
      from >= 0 &&
      to <= doc.length &&
      doc.sliceString(from, to) === this.block.source
    );
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

  /**
   * Build the table's cells for the current model. A cell whose text some
   * rendered cell already shows takes that rendering, moved to its new line,
   * so adding, removing or moving a row or column renders only new text.
   */
  render(): void {
    const rendered = this.renderedCells();
    this.table.replaceChildren();
    this.cells = [];
    const start = this.renderStart();
    const header = this.table.createTHead();
    const body = this.table.createTBody();
    this.model.rows.forEach((row, rowIndex) => {
      const element = document.createElement("tr");
      const cells = row.map((_cell, column) => {
        const cell = tableCell(rowIndex, column);
        element.append(cell);
        return cell;
      });
      this.cells.push(cells);
      (rowIndex === 0 ? header : body).append(element);
      row.forEach((cell, column) => {
        const position = { row: rowIndex, column };
        const kept = isOffsetSensitive(cell.text)
          ? undefined
          : rendered.take(cell.text);
        this.fill(position, kept, start);
      });
    });
    for (const unused of rendered.rest()) {
      this.content.disposeContent(unused);
    }
  }

  /** The content elements that hold a rendering, by the text they show. */
  private renderedCells(): RenderedCells<HTMLElement> {
    const rendered = new RenderedCells<HTMLElement>();
    for (const element of this.table.querySelectorAll<HTMLElement>(
      ".table-cell-content",
    )) {
      const source = this.content.renderedSource(element);
      if (source === undefined) {
        this.content.disposeContent(element);
      } else {
        rendered.add(source, element);
      }
    }
    return rendered;
  }

  /** Give the cell at `position` the kept rendering, or render it. */
  private fill(
    position: CellPosition,
    kept: HTMLElement | undefined,
    start: number,
  ): void {
    // tableCell gives every cell its wrapper.
    const wrapper =
      this.cells[position.row]![position.column]!.firstElementChild!;
    if (!kept) {
      const content = document.createElement("div");
      content.className = "table-cell-content";
      wrapper.append(content);
      this.display(position, start);
      return;
    }
    wrapper.append(kept);
    this.align(position);
    const cell = this.model.rows[position.row]![position.column]!;
    this.content.moveContent(
      kept,
      Math.min(start + cell.from, this.outer.state.doc.length),
    );
  }

  refresh(active?: CellPosition, previous?: Table, force = false): void {
    let start: number | undefined;
    this.cells.forEach((row, rowIndex) =>
      row.forEach((_cell, column) => {
        const position = { row: rowIndex, column };
        this.align(position);
        if (!sameCell(active, position)) {
          const prevCell = previous?.rows[rowIndex]?.[column];
          const nextCell = this.model.rows[rowIndex]?.[column];
          if (
            force ||
            !prevCell ||
            !nextCell ||
            prevCell.text !== nextCell.text ||
            isOffsetSensitive(nextCell.text)
          ) {
            start ??= this.renderStart();
            this.display(position, start);
          }
        }
      }),
    );
  }

  /** Render one cell; callers rendering many pass `renderStart()` once. */
  display(position: CellPosition, start = this.renderStart()): void {
    const cell = this.model.rows[position.row]?.[position.column];
    const element = this.contentElement(position);
    if (!cell || !element) {
      return;
    }
    this.content.disposeContent(element);
    this.align(position);
    const offset = Math.min(start + cell.from, this.outer.state.doc.length);
    this.content.renderContent(element, cell.text, offset);
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

/** A header or body cell with its (empty) content wrapper. */
function tableCell(row: number, column: number): HTMLElement {
  const cell = document.createElement(row === 0 ? "th" : "td");
  cell.dataset.row = String(row);
  cell.dataset.column = String(column);
  cell.setAttribute("aria-label", `Row ${row + 1}, column ${column + 1}`);
  const wrapper = document.createElement("div");
  wrapper.className = "table-cell-wrapper";
  cell.append(wrapper);
  return cell;
}

/**
 * A footnote's number depends on where its reference is in the note, so a
 * cell that has one is rendered again even when its text is unchanged.
 */
function isOffsetSensitive(text: string): boolean {
  return text.includes("[^") || text.includes("^[");
}

/** Rendered elements by the text they show, taken in table order. */
export class RenderedCells<T> {
  private readonly byText = new Map<string, T[]>();
  add(text: string, item: T): void {
    const items = this.byText.get(text);
    if (items) {
      items.push(item);
    } else {
      this.byText.set(text, [item]);
    }
  }
  take(text: string): T | undefined {
    return this.byText.get(text)?.shift();
  }
  /** What no cell took. */
  rest(): T[] {
    return [...this.byText.values()].flat();
  }
}

export function sameCell(
  left: CellPosition | undefined,
  right: CellPosition,
): boolean {
  return left?.row === right.row && left.column === right.column;
}
