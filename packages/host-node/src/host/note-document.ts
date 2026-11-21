/**
 * One open note outside VS Code: its text, version and unsaved state, and
 * its undo and redo (note-history.ts), which last while it is open.
 */
import type { HostDocument, SourceEdit } from "@workshop/markdown/portable";
import { NoteHistory, type Edits } from "./note-history";

/** One open note. Its text here is authoritative until written to disk. */
export class NoteDocument implements HostDocument {
  version = 1;
  isDirty = false;
  readonly isUntitled = false;
  /** The text as last read from or written to disk. */
  diskText: string;
  /** Every change to the text is a step here, so undo always fits the text. */
  private readonly history = new NoteHistory();

  constructor(
    readonly uri: string,
    private text: string,
    private readonly saveNote: (note: NoteDocument) => Promise<boolean>,
  ) {
    this.diskText = text;
  }

  get id(): string {
    return this.uri;
  }

  get eol(): "\n" | "\r\n" {
    return this.text.includes("\r\n") ? "\r\n" : "\n";
  }

  getText(): string {
    return this.text;
  }

  save(): Promise<boolean> {
    return this.saveNote(this);
  }

  /** Apply non-overlapping source edits, last first, as one version and one undo step. */
  replace(edits: readonly SourceEdit[]): void {
    this.history.record(this.text, edits);
    this.change(edits);
  }

  /**
   * Take back the last step, or make the last one taken back again, as one
   * version; the edits it made, or none when there is nothing to undo or redo.
   */
  undoOrRedo(action: "undo" | "redo"): Edits {
    const edits = action === "undo" ? this.history.undo() : this.history.redo();
    if (!edits) {
      return [];
    }
    this.change(edits);
    return edits;
  }

  private change(edits: Edits): void {
    let text = this.text;
    for (const edit of edits) {
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }
    this.text = text;
    this.version += 1;
    this.isDirty = this.text !== this.diskText;
  }
}
