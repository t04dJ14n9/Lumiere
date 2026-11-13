import type { Disposer } from "@workshop/core";
import type { Cancellation } from "../rpc/lifecycle";

/** A text document VS Code owns; its text, saving and undo are VS Code's. */
export interface HostDocument {
  readonly id: string;
  readonly uri: string;
  readonly version: number;
  readonly isDirty: boolean;
  readonly isUntitled: boolean;
  readonly eol: "\n" | "\r\n";
  getText(): string;
  save(): Promise<boolean>;
}

/** A replacement of `from`–`to` (UTF-16 offsets) by `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Original-source offsets from a native document change, including CR characters. */
export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

/** Text edits for one file, by line and column (UTF-16 code units). */
export interface FileTextEdits {
  uri: string;
  edits: {
    start: { line: number; col: number };
    end: { line: number; col: number };
    text: string;
  }[];
}

/** One entry of the suggest list VS Code opens while typing in a text document. */
export interface TextCompletion {
  label: string;
  /** Shown beside the label, such as the note's path. */
  detail: string;
  /**
   * Replaces the line from column `replaceFrom` (UTF-16, as VS Code counts)
   * up to the caret, and as much of `absorbs` as follows the caret.
   */
  insert: string;
  replaceFrom: number;
  absorbs?: string;
}

/** Answers for the caret of a text document. */
export interface TextCompletionProvider {
  /**
   * The entries for a caret in the document at `uri` that follows `before`,
   * the text of its line up to it. Best first; VS Code keeps this order and
   * asks again as the user types.
   */
  complete(
    request: { uri: string; before: string },
    token: Cancellation,
  ): Promise<readonly TextCompletion[]>;
}

/** What to do once the files that were about to be deleted are gone. */
export type AfterDelete = () => void | Promise<void>;

/** VS Code's text documents: edits, saves, renames and deletions. */
export interface HostDocuments {
  /** A stable hash of a text, to tell whether a document changed. */
  fingerprint(text: string): string;
  apply(document: HostDocument, edits: readonly TextEdit[]): Promise<boolean>;
  onChange(
    listener: (document: HostDocument, changes?: readonly SourceEdit[]) => void,
  ): Disposer;
  onSave(listener: (document: HostDocument) => void): Disposer;
  /** Awaited before a save; listeners flush pending edits. */
  onWillSave(listener: (document: HostDocument) => Promise<void>): Disposer;
  open(uri: string): Promise<HostDocument>;
  /** Rename the file behind a document (Obsidian's inline title). */
  rename(document: HostDocument, target: string): Promise<void>;
  /** The current text of an open document, saved or not. */
  text(uri: string): string | undefined;
  /** Before files are renamed in VS Code; the edits apply with the rename. */
  onWillRename(
    listener: (
      renames: readonly { oldUri: string; newUri: string }[],
    ) => Promise<readonly FileTextEdits[]>,
  ): Disposer;
  /**
   * Before files are deleted in VS Code, from the Explorer or by a workspace
   * edit (not by another program, which only the file watchers see). The
   * listener sees the files while they still exist and may return what to do
   * once they are gone. Hosts that report no deletions never call it.
   */
  onWillDelete(
    listener: (
      uris: readonly string[],
    ) => AfterDelete | undefined | Promise<AfterDelete | undefined>,
  ): Disposer;
  /**
   * VS Code's suggest list for Markdown notes opened as text. Hosts without
   * a text editor of their own leave it out.
   */
  registerCompletions?(provider: TextCompletionProvider): Disposer;
}
