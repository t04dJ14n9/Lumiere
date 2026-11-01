import {
  applyColumnWidth,
  columnEdgeAt,
  MIN_COLUMN_WIDTH,
  type ColumnWidth,
} from "./column-widths";

interface ColumnEdge {
  column: number;
  /** The column's right border, in client pixels. */
  edge: number;
}

interface ResizeDrag extends ColumnEdge {
  pointer: number;
  startX: number;
  /** Every column's width when the drag began; only `column` changes. */
  frozen: number[];
  width: number;
  /** Ends the listeners that live only as long as the drag. */
  stop: AbortController;
}

/**
 * Drag a column's right border, in any row, to set its width. The border is
 * the handle: a press within `COLUMN_EDGE_REACH` pixels of it starts the
 * drag, and hovering there shows the resize cursor and a guide line down
 * the whole table. The move grips sit above and beside the table, outside
 * that band. A press that does not move writes nothing.
 */
export class ColumnResize {
  private readonly events = new AbortController();
  private readonly guide = document.createElement("div");
  private widths: ColumnWidth[] | undefined;
  private drag?: ResizeDrag;

  constructor(
    private readonly root: HTMLElement,
    private readonly table: HTMLTableElement,
    private readonly scroll: HTMLElement,
    private readonly persist: (
      widths: number[],
      column: number,
      width: number,
    ) => void,
  ) {
    this.guide.className = "table-col-resize-guide";
    this.guide.hidden = true;
    this.guide.setAttribute("aria-hidden", "true");
    root.append(this.guide);
    this.register();
  }

  /** Paint `<colgroup>` from persisted widths; omit cols that are still auto. */
  applyWidths(widths: ColumnWidth[] | undefined): void {
    this.widths = widths;
    if (!this.drag) {
      this.paint(widths);
    }
  }

  destroy(): void {
    this.cancel();
    this.events.abort();
    this.guide.remove();
  }

  private register(): void {
    const signal = this.events.signal;
    this.root.addEventListener("pointerdown", (event) => this.press(event), {
      capture: true,
      signal,
    });
    this.root.addEventListener("pointermove", (event) => this.hover(event), {
      passive: true,
      signal,
    });
    this.root.addEventListener("pointerleave", () => this.showHover(), {
      signal,
    });
    this.scroll.addEventListener("scroll", () => this.showHover(), {
      passive: true,
      signal,
    });
  }

  private hover(event: PointerEvent): void {
    // Another drag (a cell selection, say) shows no resize chrome.
    if (!this.drag && event.buttons === 0) {
      this.showHover(this.edgeAt(event.clientX, event.clientY));
    }
  }

  private press(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || this.drag) {
      return;
    }
    const hit = this.edgeAt(event.clientX, event.clientY);
    if (!hit) {
      return;
    }
    // Not a cell press: no cell opens, no selection starts.
    event.preventDefault();
    event.stopPropagation();
    this.begin(event, hit);
  }

  /** The column border under the pointer, if any. */
  private edgeAt(x: number, y: number): ColumnEdge | undefined {
    const header = this.table.rows[0];
    if (!header) {
      return undefined;
    }
    const box = this.table.getBoundingClientRect();
    const view = this.scroll.getBoundingClientRect();
    if (y < box.top || y > box.bottom || x < view.left || x > view.right) {
      return undefined;
    }
    const edges = Array.from(
      header.cells,
      (cell) => cell.getBoundingClientRect().right,
    );
    const column = columnEdgeAt(edges, x);
    return column === undefined ? undefined : { column, edge: edges[column]! };
  }

  private showHover(hit?: ColumnEdge): void {
    this.root.classList.toggle("table-col-resize-hover", hit !== undefined);
    this.placeGuide(hit?.edge);
  }

  private placeGuide(edge: number | undefined): void {
    if (edge === undefined) {
      this.guide.hidden = true;
      return;
    }
    const root = this.root.getBoundingClientRect();
    const box = this.table.getBoundingClientRect();
    this.guide.hidden = false;
    this.guide.style.left = `${edge - root.left - this.root.clientLeft}px`;
    this.guide.style.top = `${box.top - root.top - this.root.clientTop}px`;
    this.guide.style.height = `${box.height}px`;
  }

  private begin(event: PointerEvent, hit: ColumnEdge): void {
    const frozen = this.measureColumns();
    const stop = new AbortController();
    this.drag = {
      ...hit,
      pointer: event.pointerId,
      startX: event.clientX,
      frozen,
      width: frozen[hit.column]!,
      stop,
    };
    // Fix every column at its width, so only the dragged one moves.
    this.paint(frozen);
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured.
    }
    this.root.classList.add("table-col-resizing");
    this.placeGuide(hit.edge);
    const signal = stop.signal;
    window.addEventListener("pointermove", (next) => this.move(next), {
      signal,
    });
    window.addEventListener("pointerup", (next) => this.finish(next), {
      signal,
    });
    window.addEventListener(
      "pointercancel",
      (next) => {
        if (next.pointerId === this.drag?.pointer) {
          this.cancel();
        }
      },
      { signal },
    );
    window.addEventListener("blur", () => this.cancel(), { signal });
  }

  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    event.preventDefault();
    const start = drag.frozen[drag.column]!;
    const width = Math.max(
      MIN_COLUMN_WIDTH,
      Math.round(start + event.clientX - drag.startX),
    );
    if (width === drag.width) {
      return;
    }
    drag.width = width;
    this.liveCol(drag.column).style.width = `${width}px`;
    this.placeGuide(drag.edge + width - start);
  }

  private finish(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    this.end();
    if (drag.width === drag.frozen[drag.column]) {
      this.paint(this.widths);
    } else {
      this.persist(
        applyColumnWidth(drag.frozen, drag.column, drag.width),
        drag.column,
        drag.width,
      );
    }
    this.showHover(this.edgeAt(event.clientX, event.clientY));
  }

  private cancel(): void {
    if (this.drag) {
      this.end();
      this.paint(this.widths);
    }
  }

  private end(): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    delete this.drag;
    drag.stop.abort();
    this.root.classList.remove("table-col-resizing");
    if (this.root.hasPointerCapture(drag.pointer)) {
      this.root.releasePointerCapture(drag.pointer);
    }
    this.showHover();
  }

  private paint(widths: ColumnWidth[] | undefined): void {
    this.table.querySelector("colgroup")?.remove();
    if (!widths?.some((width) => width !== undefined)) {
      this.table.style.tableLayout = "";
      return;
    }
    this.table.style.tableLayout = "fixed";
    const group = document.createElement("colgroup");
    const count = Math.max(
      widths.length,
      this.table.rows[0]?.cells.length ?? 0,
    );
    for (let index = 0; index < count; index++) {
      const col = document.createElement("col");
      const width = widths[index];
      if (width !== undefined) {
        col.style.width = `${width}px`;
      }
      group.append(col);
    }
    this.table.prepend(group);
  }

  /** The dragged column's `<col>`, painted again if a re-render dropped it. */
  private liveCol(column: number): HTMLElement {
    let col = this.table.querySelectorAll("col")[column];
    if (!col) {
      this.paint(this.drag?.frozen);
      col = this.table.querySelectorAll("col")[column]!;
    }
    return col;
  }

  private measureColumns(): number[] {
    const header = this.table.rows[0];
    if (!header) {
      return [];
    }
    return Array.from(header.cells, (cell) =>
      Math.max(
        MIN_COLUMN_WIDTH,
        Math.round(cell.getBoundingClientRect().width),
      ),
    );
  }
}
