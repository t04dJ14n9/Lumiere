import type { PdfBookmarkFiles } from "../../shared/host";
import {
  parseBookmark,
  parseBookmarkEntries,
  serializeBookmarkFile,
  withBookmark,
  withoutBookmark,
  withRenamedBookmark,
  type Bookmark,
} from "../../shared/bookmarks";
import { Emitter } from "../events";

/** JSON writes a NaN page or position as null, which the parser then refuses. */
function readsBack(bookmark: Bookmark): boolean {
  return parseBookmark(JSON.parse(JSON.stringify(bookmark))) !== undefined;
}

/** The bookmark file of one PDF: where it is, and the hash of the bytes that names it. */
export interface BookmarkFileRef {
  readonly uri: string;
  readonly sha256: string;
}

/**
 * The file of the PDF a panel shows. Undefined until the viewer has the
 * PDF's bytes, which is when the hash that names the file is known.
 */
export function bookmarkFileOf(
  panel: { fileUri: string; sha256: string | undefined } | undefined,
): BookmarkFileRef | undefined {
  return panel?.sha256 === undefined
    ? undefined
    : { uri: panel.fileUri, sha256: panel.sha256 };
}

/**
 * The reader's bookmarks of PDFs, in files outside the PDFs (`bookmarks`),
 * named by the hash of the bytes they were made on, so adding one never
 * writes the PDF.
 *
 * Every change is applied to the file as it is on disk, by bookmark id, in
 * the order the changes came: a bookmark added, renamed or removed in one pane
 * or window is never undone by another's save, and two panes of this host
 * never read, change and write one file at once. Two windows saving at the
 * same instant can still lose one of the changes (each reads before the other
 * writes), as with annotations. Another window's save reaches this host
 * through the file watcher.
 *
 * A file this version cannot read (not a bookmark file, or from a newer
 * Lumiere) is never written over, and neither is one that holds an entry this
 * version refuses (malformed, or a repeat of an id): the change fails and says
 * which file. Reads still show the entries it does read.
 */
export class BookmarkStore {
  private readonly queues = new Map<string, Promise<void>>();
  /** By key: the text this host last read from the file or wrote to it. */
  private readonly known = new Map<string, string | undefined>();
  private readonly changed = new Emitter<string>();
  /** Fires with a file's key when a change this host made, or another window's save, changed it. */
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly files: PdfBookmarkFiles | undefined,
    /** A failure no caller waits for: the watcher could not read a file. */
    private readonly error: (message: string) => void,
  ) {}

  /** Which file this is: two PDFs with the same bytes in two folders keep theirs apart. */
  key(file: BookmarkFileRef): string {
    try {
      return this.files?.key?.(file.uri, file.sha256) ?? file.sha256;
    } catch {
      // The read or write that follows fails the same way, and says why.
      return file.sha256;
    }
  }

  /** The PDF's bookmarks in order; none when there is no file. Rejects when the file cannot be read. */
  read(file: BookmarkFileRef): Promise<readonly Bookmark[]> {
    if (!this.files) {
      return Promise.resolve([]);
    }
    return this.enqueue(
      file,
      async (files) => (await this.load(files, file)).list,
    );
  }

  add(file: BookmarkFileRef, bookmark: Bookmark): Promise<void> {
    return this.change(file, (list) => withBookmark(list, bookmark));
  }

  rename(file: BookmarkFileRef, id: string, title: string): Promise<void> {
    return this.change(file, (list) => withRenamedBookmark(list, id, title));
  }

  remove(file: BookmarkFileRef, id: string): Promise<void> {
    return this.change(file, (list) => withoutBookmark(list, id));
  }

  /**
   * Hear other windows' saves of this file, until the returned function is
   * called. Hosts that cannot watch hear nothing: another window's change
   * then shows the next time the file is read.
   */
  watch(file: BookmarkFileRef): () => void {
    const files = this.files;
    if (!files?.watch) {
      return () => undefined;
    }
    return files.watch(file.uri, file.sha256, () => {
      this.changedOnDisk(files, file).catch((error: unknown) => {
        this.error(
          `Could not read the bookmarks another window saved: ${String(error)}`,
        );
      });
    });
  }

  dispose(): void {
    this.changed.dispose();
  }

  /** Apply `edit` to the file as it is now, and write it if that changed it. */
  private change(
    file: BookmarkFileRef,
    edit: (list: readonly Bookmark[]) => readonly Bookmark[],
  ): Promise<void> {
    return this.enqueue(file, async (files) => {
      const { list, text, unread } = await this.load(files, file);
      const edited = edit(list);
      if (edited === list) {
        return;
      }
      // A bookmark that would not read back (JSON turns a NaN into null) would
      // make every later change fail, so it is refused before anything is written.
      if (!edited.every(readsBack)) {
        throw new Error(
          "Cannot save a bookmark that would not read back from its file.",
        );
      }
      const written = serializeBookmarkFile(edited, unread);
      if (written === text) {
        return;
      }
      await files.write(file.uri, file.sha256, written);
      this.known.set(this.key(file), written);
      this.changed.fire(this.key(file));
    });
  }

  /**
   * Copies a PDF's bookmarks to the bytes Lumiere rewrote it to. The old file
   * stays, since another copy of the old PDF still reads it, and a file that
   * already exists under the new bytes is never overwritten.
   */
  carry(from: BookmarkFileRef, to: BookmarkFileRef): Promise<void> {
    return this.enqueue(to, async (files) => {
      const text = await files.read(from.uri, from.sha256);
      if (
        text === undefined ||
        (await files.read(to.uri, to.sha256)) !== undefined
      ) {
        return;
      }
      await files.write(to.uri, to.sha256, text);
      this.known.set(this.key(to), text);
      this.changed.fire(this.key(to));
    });
  }

  /** The file's text and what it holds; reading it is what the host knows of it from now on. */
  private async load(
    files: PdfBookmarkFiles,
    file: BookmarkFileRef,
  ): Promise<{
    list: readonly Bookmark[];
    text: string | undefined;
    unread: unknown[];
  }> {
    const text = await files.read(file.uri, file.sha256);
    this.known.set(this.key(file), text);
    if (text === undefined) {
      return { list: [], text, unread: [] };
    }
    try {
      const { bookmarks, unread } = parseBookmarkEntries(text);
      return { list: bookmarks, text, unread };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot use ${this.key(file)}. ${why}`, { cause: error });
    }
  }

  /** In the queue, after this host's own saves: a file as one of them left it is no news. */
  private changedOnDisk(
    files: PdfBookmarkFiles,
    file: BookmarkFileRef,
  ): Promise<void> {
    const key = this.key(file);
    return this.enqueueOn(key, async () => {
      const text = await files.read(file.uri, file.sha256);
      if (this.known.has(key) && this.known.get(key) === text) {
        return;
      }
      this.known.set(key, text);
      this.changed.fire(key);
    });
  }

  private enqueue<T>(
    file: BookmarkFileRef,
    run: (files: PdfBookmarkFiles) => Promise<T>,
  ): Promise<T> {
    const files = this.files;
    if (!files) {
      return Promise.reject(
        new Error("This host has nowhere to keep bookmarks."),
      );
    }
    return this.enqueueOn(this.key(file), () => run(files));
  }

  private enqueueOn<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(run);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) {
        this.queues.delete(key);
      }
    });
    return next;
  }
}
