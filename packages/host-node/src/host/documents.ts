/**
 * Notes outside VS Code: files on the host's disk. VS Code owns a note's text,
 * saving and undo; here this module does. A note's text lives in memory while
 * a panel shows it and is written back once typing pauses, as Obsidian does.
 */
import type { Disposer } from "@workshop/core";
import {
  diskChangeConflicts,
  mergeDiskChange,
  SourceCoordinates,
  type HostDocument,
  type HostDocuments,
  type SourceEdit,
  type TextEdit,
} from "@workshop/markdown/portable";
import { writeConflictCopy } from "./conflict-copy";
import type { NoteFiles } from "./note-files";

export { noteFiles, type NoteFiles } from "./note-files";

/** How long typing must pause before a note is written to disk. */
export const AUTOSAVE_DELAY_MS = 800;

type ChangeListener = (
  document: HostDocument,
  changes?: readonly SourceEdit[],
) => void;

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

/**
 * Whether a disk read is another program's change to the open note. A read
 * that started before a save finished is stale: applying it would undo that
 * save. One that equals what we last read or wrote is our own write coming
 * back. A read made while a save was writing is not taken either: the save's
 * own rename (atomic-write.ts) wakes the watch, and the read may see the old
 * text or the new one before the save is counted.
 */
export function diskReadChangesNote(state: {
  text: string;
  diskText: string;
  open: boolean;
  writesAtStart: number;
  writesNow: number;
  /** A save was writing the file when the read started or when it ended. */
  writing: boolean;
}): boolean {
  return (
    state.open &&
    !state.writing &&
    state.writesAtStart === state.writesNow &&
    state.text !== state.diskText
  );
}

/** Every open note, with the events the plugins and the vault listen to. */
export class NoteDocuments implements HostDocuments {
  private readonly notes = new Map<string, NoteDocument>();
  private readonly users = new Map<string, number>();
  private readonly watchers = new Map<string, () => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly saving = new Map<string, Promise<boolean>>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly saveListeners = new Set<(note: HostDocument) => void>();
  private readonly willSave = new Set<(note: HostDocument) => Promise<void>>();
  private readonly closeListeners = new Set<(uri: string) => void>();
  private readonly saveFailedListeners = new Set<
    (uri: string, error: unknown) => void
  >();
  private readonly conflictListeners = new Set<
    (uri: string, copy: string) => void
  >();
  /** Saves that have reached disk. A reload captures this before it reads. */
  private readonly settledWrites = new Map<string, number>();
  /** Notes a save is writing to disk now. */
  private readonly writing = new Set<string>();
  /** Notes whose reload was dropped during a save, to read again after it. */
  private readonly rereadAfterWrite = new Set<string>();

  constructor(
    private readonly files: NoteFiles,
    private readonly delay = AUTOSAVE_DELAY_MS,
    /** Where a reload that failed goes: no one awaits one. */
    private readonly log: (message: string) => void = (message) =>
      console.warn(message),
  ) {}

  fingerprint(text: string): string {
    return this.files.sha256(text);
  }

  async apply(
    document: HostDocument,
    edits: readonly TextEdit[],
  ): Promise<boolean> {
    const note = this.notes.get(document.uri);
    if (!note || note !== document) {
      return false;
    }
    const coordinates = new SourceCoordinates(note.getText());
    // Last first, so each range still refers to the text before the others.
    const changes = edits
      .map((edit) => ({
        from: coordinates.toSource(edit.from),
        to: coordinates.toSource(edit.to),
        insert: edit.insert,
      }))
      .sort((a, b) => b.from - a.from);
    note.replace(changes);
    this.emitChange(note, changes);
    this.scheduleSave(note);
    return true;
  }

  async open(uri: string): Promise<NoteDocument> {
    const open = this.notes.get(uri);
    if (open) {
      return open;
    }
    const text = await this.readNote(uri);
    // Another open() may have finished while this one read the file.
    const raced = this.notes.get(uri);
    if (raced) {
      return raced;
    }
    const note = new NoteDocument(uri, text, (item) => this.save(item));
    this.notes.set(uri, note);
    this.watchers.set(uri, this.watchFile(note));
    return note;
  }

  /** A panel now shows the note; `release` when it stops. */
  retain(uri: string): void {
    this.users.set(uri, (this.users.get(uri) ?? 0) + 1);
  }

  /** The last panel showing the note closed: write it and forget it. */
  async release(uri: string): Promise<void> {
    const users = (this.users.get(uri) ?? 1) - 1;
    if (users > 0) {
      this.users.set(uri, users);
      return;
    }
    this.users.delete(uri);
    const note = this.notes.get(uri);
    if (note?.isDirty) {
      // No one awaits a release (its panel is gone): report a failed write
      // like one made after typing paused. Keep the unsaved note open, so
      // opening it again shows the text; dispose() still closes its watch.
      const saved = await this.save(note).catch((error: unknown) => {
        this.reportSaveFailed(uri, error);
        return false;
      });
      // Typing that arrived during the write is unsaved: a later release or
      // autosave owns it, and closing now would drop it if that save fails.
      if (!saved || note.isDirty) {
        return;
      }
    }
    if ((this.users.get(uri) ?? 0) > 0) {
      return;
    }
    this.close(uri);
  }

  text(uri: string): string | undefined {
    return this.notes.get(uri)?.getText();
  }

  async rename(): Promise<void> {
    throw new Error("Renaming a note is not available here yet");
  }

  onChange(listener: ChangeListener): Disposer {
    return subscribe(this.changeListeners, listener);
  }

  onSave(listener: (document: HostDocument) => void): Disposer {
    return subscribe(this.saveListeners, listener);
  }

  onWillSave(listener: (document: HostDocument) => Promise<void>): Disposer {
    return subscribe(this.willSave, listener);
  }

  /** No host reports renames here, so there is nothing to update links for. */
  onWillRename(): Disposer {
    return () => {};
  }

  /** Nor deletions, so there are no attachments to offer to delete. */
  onWillDelete(): Disposer {
    return () => {};
  }

  onClosed(listener: (uri: string) => void): Disposer {
    return subscribe(this.closeListeners, listener);
  }

  /**
   * A save no one waited for (one made after typing paused) failed: the
   * note's text is still here, unsaved, and the reader must be told.
   */
  onSaveFailed(listener: (uri: string, error: unknown) => void): Disposer {
    return subscribe(this.saveFailedListeners, listener);
  }

  /**
   * Unsaved typing was written over another program's change to the note:
   * that version was kept in `copy`, beside it, and the reader must be told.
   */
  onConflict(listener: (uri: string, copy: string) => void): Disposer {
    return subscribe(this.conflictListeners, listener);
  }

  /**
   * Write every note with unsaved text, then stop watching files. Watches
   * close even when a write fails: an open watch keeps the host process alive.
   */
  async dispose(): Promise<void> {
    const writes = this.saveAll();
    await writes.catch(() => {});
    for (const uri of [...this.notes.keys()]) {
      this.close(uri);
    }
    await writes;
  }

  /**
   * Write every note with unsaved text now, without waiting for autosave;
   * rejects with the first failure once every write has settled.
   */
  async saveAll(): Promise<void> {
    const writes = await Promise.allSettled(
      [...this.notes.values()]
        .filter((note) => note.isDirty)
        .map((note) => this.save(note)),
    );
    const failed = writes.find((write) => write.status === "rejected");
    if (failed) {
      throw failed.reason;
    }
  }

  /**
   * Write a note with unsaved text now, as its autosave would after the
   * pause (its page was hidden); a failure is reported the same way.
   */
  saveNow(note: NoteDocument): void {
    if (!note.isDirty) {
      return;
    }
    this.cancelSave(note.uri);
    this.save(note).catch((error: unknown) =>
      this.reportSaveFailed(note.uri, error),
    );
  }

  /** One write at a time per note; a save asked for during a write follows it. */
  save(note: NoteDocument): Promise<boolean> {
    const previous = this.saving.get(note.uri) ?? Promise.resolve(true);
    // A failed write was already reported to its caller; the next one must
    // still run, or one full disk would stop every later save of the note.
    const next = previous.catch(() => false).then(() => this.write(note));
    this.saving.set(note.uri, next);
    return next;
  }

  private async write(note: NoteDocument): Promise<boolean> {
    this.cancelSave(note.uri);
    await this.prepareSave(note);
    if (await this.tookOutsideChange(note)) {
      return true;
    }
    // Taken after the disk check: typing made while it read is saved too.
    const text = note.getText();
    this.writing.add(note.uri);
    try {
      await this.files.save(note.uri, text);
    } finally {
      this.writing.delete(note.uri);
    }
    // Count the save before publishing diskText, so a reload that resumes
    // in between still sees that its read is older than this write.
    this.settledWrites.set(
      note.uri,
      (this.settledWrites.get(note.uri) ?? 0) + 1,
    );
    note.diskText = text;
    note.isDirty = note.getText() !== text;
    for (const listener of this.saveListeners) {
      listener(note);
    }
    // Another program may have written while we did; its watch event fell
    // inside our write and was dropped.
    if (this.rereadAfterWrite.delete(note.uri)) {
      this.reloadUnawaited(note);
    }
    return true;
  }

  /**
   * Run the will-save listeners (a page flushing its pending edits). As in
   * VS Code, a listener that fails or times out does not stop the save: a
   * page composing with an IME holds its edits back past the flush's wait,
   * and failing the save for that reported an error for nothing. The held
   * edits arrive later as edits, which schedule their own save.
   */
  private async prepareSave(note: NoteDocument): Promise<void> {
    const results = await Promise.allSettled(
      [...this.willSave].map((listener) => listener(note)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.log(
          `Lumière saved ${note.uri} without waiting for its page: ${errorText(result.reason)}`,
        );
      }
    }
  }

  /**
   * Another program may have changed the file since we last read or wrote
   * it: its watch event may not have come, or a reload left a conflicting
   * change to this save. The change is merged into the note as a reload
   * merges it; where both changed the same lines differently, unsaved typing
   * wins the note's file and the other version is first kept in a copy beside
   * it. True when nothing is left to write. (A change landing between this
   * read and the write is not seen; the window is one read long.) Whether
   * typing is unsaved is decided once the read and the copy are done: the
   * user may type meanwhile. A read that fails fails the save: without it we
   * cannot tell whether we would write over another program's change (and
   * saving replaces an existing file only, so a missing one could not be
   * written either).
   */
  private async tookOutsideChange(note: NoteDocument): Promise<boolean> {
    const disk = await this.readNote(note.uri);
    if (disk === note.diskText) {
      return false;
    }
    if (this.conflictsWithTyping(note, disk)) {
      const copy = await writeConflictCopy(this.files, note.uri, disk);
      for (const listener of this.conflictListeners) {
        listener(note.uri, copy);
      }
    }
    this.takeDiskText(note, disk);
    return !note.isDirty;
  }

  /** Whether merging `disk` into the note would drop some of its lines. */
  private conflictsWithTyping(note: NoteDocument, disk: string): boolean {
    return diskChangeConflicts({
      saved: note.diskText,
      buffer: note.getText(),
      disk,
    });
  }

  private scheduleSave(note: NoteDocument): void {
    this.cancelSave(note.uri);
    this.timers.set(
      note.uri,
      setTimeout(() => {
        this.timers.delete(note.uri);
        this.save(note).catch((error: unknown) =>
          this.reportSaveFailed(note.uri, error),
        );
      }, this.delay),
    );
  }

  private reportSaveFailed(uri: string, error: unknown): void {
    for (const listener of this.saveFailedListeners) {
      listener(uri, error);
    }
  }

  private cancelSave(uri: string): void {
    clearTimeout(this.timers.get(uri));
    this.timers.delete(uri);
  }

  private emitChange(note: NoteDocument, changes: readonly SourceEdit[]): void {
    for (const listener of this.changeListeners) {
      listener(note, changes);
    }
  }

  /**
   * Another program changed the file: take its text, merged with ours if ours
   * is unsaved. (Platforms watch a file's folder: editors that save by
   * renaming a new file over the old one would end a watch on the file itself.)
   */
  private watchFile(note: NoteDocument): () => void {
    return this.files.watch(note.uri, () => this.reloadUnawaited(note));
  }

  /** A reload started by a file event: a listener that throws is logged. */
  private reloadUnawaited(note: NoteDocument): void {
    this.reload(note).catch((error: unknown) =>
      this.log(`Lumière could not reload ${note.uri}: ${errorText(error)}`),
    );
  }

  private async reload(note: NoteDocument): Promise<void> {
    const writesAtStart = this.settledWrites.get(note.uri) ?? 0;
    const writingAtStart = this.writing.has(note.uri);
    let text: string;
    try {
      text = await this.readNote(note.uri);
    } catch {
      return;
    }
    const writing = writingAtStart || this.writing.has(note.uri);
    if (writing) {
      this.rereadAfterWrite.add(note.uri);
    }
    // Our own writes come back here. A read that overlapped a save is
    // dropped: it can still hold the old bytes, or none; one made during the
    // write is made again after it.
    if (
      !diskReadChangesNote({
        text,
        diskText: note.diskText,
        open: this.notes.get(note.uri) === note,
        writesAtStart,
        writesNow: this.settledWrites.get(note.uri) ?? 0,
        writing,
      })
    ) {
      return;
    }
    // Where both changed the same lines, the merge would drop the other
    // program's lines: the save keeps them in a conflict copy first, and
    // merges then. (A failed copy fails that save, and the file stays as the
    // other program left it.)
    if (this.conflictsWithTyping(note, text)) {
      this.scheduleSave(note);
      return;
    }
    this.takeDiskText(note, text);
    // What still differs from the file reaches it after a pause, as typing does.
    if (note.isDirty) {
      this.scheduleSave(note);
    } else {
      this.cancelSave(note.uri);
    }
  }

  /**
   * Take another program's text: merged into unsaved typing, so neither side
   * is dropped for the other and the next save cannot write over it. (VS Code
   * leaves a note with unsaved changes as it is and reports a conflict when
   * it is saved; here nobody is asked, the save is automatic.) A clean note's
   * text is diskText, so for it the merge is the outside text.
   */
  private takeDiskText(note: NoteDocument, text: string): void {
    const merged = mergeDiskChange({
      saved: note.diskText,
      buffer: note.getText(),
      disk: text,
    });
    note.diskText = text;
    if (merged !== note.getText()) {
      const change = { from: 0, to: note.getText().length, insert: merged };
      note.replace([change]);
      this.emitChange(note, [change]);
    } else {
      note.isDirty = merged !== text;
    }
  }

  private close(uri: string): void {
    this.cancelSave(uri);
    this.watchers.get(uri)?.();
    this.watchers.delete(uri);
    this.saving.delete(uri);
    this.rereadAfterWrite.delete(uri);
    if (this.notes.delete(uri)) {
      for (const listener of this.closeListeners) {
        listener(uri);
      }
    }
  }

  private readNote(uri: string): Promise<string> {
    return this.files.readText(uri);
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subscribe<T>(listeners: Set<T>, listener: T): Disposer {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
