/**
 * Renaming and moving notes outside VS Code, with the links to them updated
 * as VS Code's rename updates them: the will-rename listeners (the
 * linkUpdates plugin) plan the edits while the files are still where they
 * were, the files move, and the edits are applied after it, to an open
 * note's text or to the file on disk.
 */
import type { Disposer } from "@workshop/core";
import {
  applyLineColEdits,
  isSameText,
  SourceCoordinates,
  type FileTextEdits,
  type HostDocument,
  type TextEdit,
} from "@workshop/markdown/portable";
import type { NoteFiles } from "./note-files";

export interface Rename {
  readonly oldUri: string;
  readonly newUri: string;
}

export type WillRename = (
  renames: readonly Rename[],
) => Promise<readonly FileTextEdits[]>;

/** What renaming reaches: the files, and the notes open in the host. */
export interface RenameTargets {
  /** Move a file or folder; a target that exists is refused. */
  move(from: string, to: string): Promise<void>;
  readText(uri: string): Promise<string>;
  save(uri: string, text: string): Promise<void>;
  /** An open note's text; undefined when it is not open. */
  openText(uri: string): string | undefined;
  /** Replace an open note's whole text; it is written after the pause. */
  replaceOpen(uri: string, text: string): Promise<void>;
}

/** What renaming needs of the open notes (NoteDocuments). */
export interface RenamedNotes {
  /** Write every unsaved note, so what moves is what the reader sees. */
  saveAll(): Promise<void>;
  text(uri: string): string | undefined;
  open(uri: string): Promise<HostDocument>;
  apply(document: HostDocument, edits: readonly TextEdit[]): Promise<boolean>;
  /** Leave the notes open at or under `uri` clean: their file is gone. */
  forget(uri: string): void;
}

/** Renames and moves of notes and folders, and who hears of them. */
export class NoteRenames {
  private readonly willRename = new Set<WillRename>();
  private readonly listeners = new Set<(rename: Rename) => void>();

  constructor(
    private readonly files: Pick<NoteFiles, "readText" | "save" | "move">,
    private readonly notes: RenamedNotes,
  ) {}

  onWillRename(listener: WillRename): Disposer {
    this.willRename.add(listener);
    return () => {
      this.willRename.delete(listener);
    };
  }

  /** A file or folder was renamed or moved here. */
  onDidRename(listener: (rename: Rename) => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Rename a note in its folder (the inline title), as VS Code checks it. */
  async renameNote(from: string, to: string): Promise<void> {
    checkTitleRename(from, to);
    await this.renameFiles([{ oldUri: from, newUri: to }]);
  }

  /**
   * Rename or move files and folders, updating the links to them as VS
   * Code's rename does. Unsaved notes are written first. Notes open at an
   * old name are left clean, so closing their page writes nothing there;
   * `onDidRename` tells the embedder to show the new one. Returns the notes
   * whose links were left as they were.
   */
  async renameFiles(renames: readonly Rename[]): Promise<string[]> {
    const { files } = this;
    const { move } = files;
    if (!move) {
      throw new Error("Renaming is not available here");
    }
    await this.notes.saveAll();
    const notUpdated = await renameWithLinks(renames, [...this.willRename], {
      move: (from, to) => move(from, to),
      readText: (uri) => files.readText(uri),
      save: (uri, text) => files.save(uri, text),
      openText: (uri) => this.notes.text(uri),
      replaceOpen: (uri, text) => this.replaceOpen(uri, text),
    });
    for (const rename of renames) {
      this.notes.forget(rename.oldUri);
      for (const listener of this.listeners) {
        listener(rename);
      }
    }
    return notUpdated;
  }

  /** An open note's whole text replaced, as an edit, written after the pause. */
  private async replaceOpen(uri: string, text: string): Promise<void> {
    const note = await this.notes.open(uri);
    const now = note.getText();
    const end = new SourceCoordinates(now).toEditor(now.length);
    await this.notes.apply(note, [{ from: 0, to: end, insert: text }]);
  }
}

/**
 * Plan the link edits, move the files, then apply the edits. Returns the
 * notes whose links were left as they were: changed since the edits were
 * planned, or unreadable.
 */
export async function renameWithLinks(
  renames: readonly Rename[],
  listeners: Iterable<WillRename>,
  targets: RenameTargets,
): Promise<string[]> {
  const planned: FileTextEdits[] = [];
  for (const listener of listeners) {
    planned.push(...(await listener(renames)));
  }
  for (const { oldUri, newUri } of renames) {
    await targets.move(oldUri, newUri);
  }
  const notUpdated: string[] = [];
  for (const file of planned) {
    if (file.edits.length === 0) {
      continue;
    }
    const uri = afterRenames(file.uri, renames);
    if (!(await applyFileEdits(uri, file, targets))) {
      notUpdated.push(uri);
    }
  }
  return notUpdated;
}

/**
 * Apply one note's edits where its text is now. Only text that still reads
 * as it did when they were planned is changed: line and column positions
 * would land elsewhere in any other.
 */
async function applyFileEdits(
  uri: string,
  file: FileTextEdits,
  targets: RenameTargets,
): Promise<boolean> {
  try {
    const open = targets.openText(uri);
    const text = open ?? (await targets.readText(uri));
    if (file.source !== undefined && !isSameText(text, file.source)) {
      return false;
    }
    const next = applyLineColEdits(text, file.edits);
    if (open === undefined) {
      await targets.save(uri, next);
    } else {
      await targets.replaceOpen(uri, next);
    }
    return true;
  } catch {
    return false;
  }
}

/** A URI as it is after `renames`: the file renamed, or one in a folder renamed. */
export function afterRenames(uri: string, renames: readonly Rename[]): string {
  for (const { oldUri, newUri } of renames) {
    if (uri === oldUri) {
      return newUri;
    }
    const prefix = oldUri.endsWith("/") ? oldUri : `${oldUri}/`;
    if (uri.startsWith(prefix)) {
      return `${newUri.replace(/\/$/, "")}/${uri.slice(prefix.length)}`;
    }
  }
  return uri;
}

/** Whether `uri` is `root` or inside it. */
export function isAtOrUnder(uri: string, root: string): boolean {
  return uri === root || uri.startsWith(`${root.replace(/\/$/, "")}/`);
}

/**
 * As VS Code's own check of a title rename (src/host/file-rename.ts): a
 * note keeps its folder and its extension.
 */
export function checkTitleRename(from: string, to: string): void {
  const folder = (uri: string) => uri.slice(0, uri.lastIndexOf("/"));
  const extension = (uri: string) => /\.[^./]*$/.exec(uri)?.[0] ?? "";
  const name = to.slice(to.lastIndexOf("/") + 1);
  if (
    folder(from) !== folder(to) ||
    extension(from) !== extension(to) ||
    /[?#\\\r\n\0]/.test(name) ||
    name === ""
  ) {
    throw new Error("Invalid note rename target.");
  }
}
