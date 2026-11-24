import {
  copyCells,
  copyCellsHtml,
  copyCellsMarkdown,
  copyCellsObsidian,
  pastedCells,
  pastedMarkdownCells,
  pastedObsidianRows,
} from "../../markdown/tables/clipboard-formats";
import {
  parseTable,
  rangeTexts,
  toggleMarker,
  writeCells,
  type CellPosition,
  type CellRange,
} from "../../markdown/tables/model";

import type { TableGrid } from "./grid";
import type { CellProjection } from "./projection";
import type { TableSelection } from "./selection";
import type { TableEnvironment } from "./environment";

interface CellSessionSnapshot {
  revision: number;
  active: Partial<CellPosition>;
}

function isCurrentCellSession(
  projection: Pick<CellProjection, "sessionRevision" | "active">,
  snapshot: CellSessionSnapshot,
): boolean {
  return (
    snapshot.revision === projection.sessionRevision &&
    snapshot.active.row === projection.active?.row &&
    snapshot.active.column === projection.active?.column
  );
}

/** Clipboard and formatting operations over cell text or a rectangular range. */
export class TableClipboard {
  constructor(
    private readonly grid: TableGrid,
    private readonly projection: CellProjection,
    private readonly selection: TableSelection,
    private readonly environment: Pick<
      TableEnvironment,
      "copy" | "paste" | "wrap" | "clearFormatting" | "canFormat"
    >,
  ) {}

  get canFormat(): boolean {
    return this.environment.canFormat;
  }

  /** A read-only note's table is copied from, never written to. */
  private get isReadOnly(): boolean {
    return this.grid.outer.state.readOnly;
  }
  keyDown(event: KeyboardEvent): void {
    const range = this.selection.range;
    if (
      !range ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.shiftKey ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== "c"
    ) {
      return;
    }
    // Grid selection focuses a non-editable element with no DOM text range.
    // Chromium may never emit copy there; the host also owns native clipboard
    // access in VS Code. Claim the key so forwarding cannot overwrite the TSV.
    event.preventDefault();
    event.stopPropagation();
    void this.environment.copy(copyCells(this.grid.model, range));
  }

  copy(event: ClipboardEvent, cut: boolean): void {
    if (!this.selection.range || !event.clipboardData) {
      return;
    }
    event.preventDefault();
    const range = this.selection.range;
    const model = this.grid.model;
    // The four flavors Obsidian offers for a copied table: TSV as text/plain
    // for spreadsheets, Markdown and HTML for notes, and obsidian/table rows,
    // which a table paste reads back cell for cell.
    event.clipboardData.setData("text/plain", copyCells(model, range));
    event.clipboardData.setData(
      "text/markdown",
      copyCellsMarkdown(model, range),
    );
    event.clipboardData.setData("text/html", copyCellsHtml(model, range));
    event.clipboardData.setData(
      "obsidian/table",
      JSON.stringify(copyCellsObsidian(model, range)),
    );
    if (cut) {
      this.grid.replace(writeCells(model, range, [[""]]));
    }
  }

  paste(event: ClipboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const data = event.clipboardData;
    const range =
      this.selection.range ??
      (this.projection.active && {
        anchor: this.projection.active,
        head: this.projection.active,
      });
    if (!data || !range) {
      return;
    }
    const rows = pastedObsidianRows(data.getData("obsidian/table"));
    if (rows) {
      event.preventDefault();
      this.grid.replace(writeCells(this.grid.model, range, rows));
      return;
    }
    const text =
      data.getData("text/plain") || data.getData("text/markdown") || "";
    if (!this.selection.range && !/[\t\r\n|]/.test(text)) {
      return;
    }
    event.preventDefault();
    this.pasteText(text, range);
  }

  /**
   * Write pasted text into the range: a Markdown table cell for cell, other
   * text split at tabs and lines. Plain text is never read as a table.
   */
  pasteText(text: string, range: CellRange, plainText = false): void {
    if (!text) {
      return;
    }
    const cells =
      !plainText && looksLikeMarkdownTable(text)
        ? pastedMarkdownCells(text)
        : pastedCells(text);
    this.grid.replace(writeCells(this.grid.model, range, cells));
  }

  /**
   * Menu Copy or Cut. A Cut clears only after the clipboard has the text, and
   * only if the table or cell still holds what was copied; a write that fails
   * keeps the cells. Copy does not wait for the clipboard.
   */
  async copyFromMenu(range: CellRange, cut: boolean): Promise<void> {
    const context = this.environment;
    const inner = this.projection.inner;
    const selection = inner?.state.selection.main;
    if (!this.selection.range && inner && selection && !selection.empty) {
      const text = inner.state.sliceDoc(selection.from, selection.to);
      if (!cut) {
        void context.copy(text);
        inner.focus();
        return;
      }
      await this.cutCellText(inner, text);
      return;
    }
    const text = copyCells(this.grid.model, range);
    if (!cut) {
      void context.copy(text);
      (this.projection.inner ?? this.grid.outer).focus();
      return;
    }
    // Menus remove their focused DOM before the action runs: restore focus so
    // blur cleanup does not close the table while the clipboard is written.
    (this.projection.inner ?? this.grid.outer).focus();
    const expected = this.grid.block.source;
    const grid = this.selection.range;
    if (!(await context.copy(text))) {
      return;
    }
    if (expected !== this.grid.block.source || grid !== this.selection.range) {
      throw new Error(
        "The table or selection changed before Cut completed. Cut again.",
      );
    }
    this.clearCells(range);
  }

  /**
   * Cut of selected cell text: the cut is for the cell it was copied from,
   * and clears nothing when the clipboard write fails or the cell changes.
   */
  private async cutCellText(
    inner: NonNullable<CellProjection["inner"]>,
    text: string,
  ): Promise<void> {
    // Menus remove their focused DOM before the action runs: restore focus so
    // blur cleanup does not close the editor while the clipboard is written.
    inner.focus();
    // The cell editor is retained and reused, so the cut is for the cell it
    // copied from: the same checks as paste's re-check after its read.
    const session = {
      revision: this.projection.sessionRevision,
      active: { ...this.projection.active },
    };
    if (!(await this.environment.copy(text))) {
      inner.focus();
      return;
    }
    const now = inner.state.selection.main;
    if (
      inner !== this.projection.inner ||
      !isCurrentCellSession(this.projection, session) ||
      inner.state.sliceDoc(now.from, now.to) !== text
    ) {
      throw new Error("The selection changed before Cut completed. Cut again.");
    }
    if (!this.isReadOnly) {
      inner.dispatch(inner.state.replaceSelection(""));
    }
    inner.focus();
    return;
  }

  async pasteFromMenu(range: CellRange, plainText = false): Promise<void> {
    if (this.isReadOnly) {
      return;
    }
    const expected = this.grid.block.source;
    const editor = this.projection.inner;
    // Word navigation mutates the retained editor's position object in place.
    const session = {
      revision: this.projection.sessionRevision,
      active: { ...this.projection.active },
    };
    const selection = editor?.state.selection;
    const grid = this.selection.range;
    const context = this.environment;
    if (!context.paste) {
      throw new Error("Use the keyboard paste shortcut in this view.");
    }
    // Menus remove their focused DOM before awaiting clipboard RPC.
    // Restore focus now so blur cleanup does not close a still-valid editor.
    (editor ?? this.grid.root).focus();
    const text = await context.paste();
    if (!this.grid.root.isConnected) {
      return;
    }
    if (
      expected !== this.grid.block.source ||
      editor !== this.projection.inner ||
      !isCurrentCellSession(this.projection, session) ||
      grid !== this.selection.range ||
      (selection && !selection.eq(editor.state.selection))
    ) {
      throw new Error(
        "The table or selection changed before paste completed. Paste again.",
      );
    }
    this.insertPasted(text, range, plainText);
  }

  /**
   * Paste's write: one line of text into the open cell, anything else over
   * the cells. Nothing when the note turned read-only while the clipboard
   * was read: no cell closes and the selection stays.
   */
  private insertPasted(text: string, range: CellRange, plainText: boolean) {
    if (this.isReadOnly) {
      return;
    }
    if (
      this.projection.inner &&
      !this.selection.range &&
      !/[\t\r\n]/.test(text)
    ) {
      this.projection.inner.dispatch(
        this.projection.inner.state.replaceSelection(text),
      );
      this.projection.inner.focus();
    } else {
      this.projection.close();
      this.selection.range = range;
      this.pasteText(text, range, plainText);
      this.selection.highlight();
      this.grid.root.focus();
    }
  }

  clearCells(range: CellRange): void {
    if (this.isReadOnly) {
      return;
    }
    this.selection.activate(range);
    this.grid.replace(writeCells(this.grid.model, range, [[""]]));
    this.selection.highlight();
    this.grid.root.focus();
  }

  formatCells(range: CellRange, marker: string | null): void {
    // Not even the select-all a cell's formatting starts with.
    if (this.isReadOnly) {
      return;
    }
    if (this.projection.inner && !this.selection.range) {
      const editor = this.projection.inner;
      if (editor.state.selection.main.empty) {
        editor.dispatch({
          selection: { anchor: 0, head: editor.state.doc.length },
        });
      }
      if (marker) {
        this.environment.wrap(marker, editor);
      } else {
        const selected = editor.state.selection.main;
        editor.dispatch(
          editor.state.replaceSelection(
            this.environment.clearFormatting(
              editor.state.sliceDoc(selected.from, selected.to),
            ),
          ),
        );
      }
      editor.focus();
      return;
    }
    const values = rangeTexts(this.grid.model, range).map((row) =>
      row.map((text) =>
        marker === null
          ? this.environment.clearFormatting(text)
          : toggleMarker(text, marker),
      ),
    );
    this.grid.replace(writeCells(this.grid.model, range, values));
    this.grid.root.focus();
  }
}

function looksLikeMarkdownTable(text: string): boolean {
  // The header and delimiter rows decide, as in the editor's table parser:
  // one or more dashes per delimiter cell and as many cells as the header.
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  return parseTable(lines.slice(0, 2).join("\n")) !== undefined;
}
