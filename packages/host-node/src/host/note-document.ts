/** One open note outside VS Code: its text, version and unsaved state. */
import type { HostDocument, SourceEdit } from "@workshop/markdown/portable";

/** One open note. Its text here is authoritative until written to disk. */
export class NoteDocument implements HostDocument {
  version = 1;
  isDirty = false;
  readonly isUntitled = false;
  /** The text as last read from or written to disk. */
  diskText: string;

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

  /** Apply non-overlapping source edits, last first, as one version. */
  replace(edits: readonly SourceEdit[]): void {
    let text = this.text;
    for (const edit of edits) {
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }
    this.text = text;
    this.version += 1;
    this.isDirty = this.text !== this.diskText;
  }
}
