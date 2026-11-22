import type * as vscode from "vscode";

/** A range of text in a Markdown note, with its 1-based line range. */
export interface NoteRange {
  readonly text: string;
  /** Source offsets, in UTF-16 units. */
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
}

/** The text selected in a Markdown note. */
export interface NoteSelection extends NoteRange {
  readonly uri: vscode.Uri;
  /** Unsaved: the line numbers may not match the file on disk. */
  readonly isDirty: boolean;
}

/** The Markdown note the reader is in. */
export interface ActiveNote {
  readonly uri: vscode.Uri;
  readonly isDirty: boolean;
  /**
   * The selected text, when there is any. Lumiere's API reports a selection,
   * not a collapsed caret, so a note with only a caret has none.
   */
  readonly selection?: NoteRange;
  /** The headings that enclose the selection's first line, outermost first. */
  readonly headingPath: readonly string[];
}

/**
 * What the agent bridge needs from the Markdown editor (Lumiere,
 * in the same extension); the composition root provides it.
 */
export interface NoteSelections {
  /** Whether any note is open in the Markdown editor. */
  hasOpenNotes(): boolean;
  /** The active note's selection, else the first open note's; none if empty. */
  current(): Promise<NoteSelection | undefined>;
  /** The active note, else the first open one; none when no note is open. */
  active(): Promise<ActiveNote | undefined>;
}
