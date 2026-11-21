import type { PdfAnnotationFiles, PdfFiles } from "../../shared/host";
import type { ViewerMessage } from "../../shared/messages";
import {
  mergeAnnotationFile,
  sameAnnotations,
} from "../../shared/annotation-merge";

/**
 * The editors whose annotation files one host's `PdfAnnotationFiles` keeps,
 * and the saves to each file (by its key: `PdfAnnotationFiles.key`, else the
 * PDF's hash, which names it) in the order they came: two editors of one PDF
 * never read, merge and write the same file at once.
 */
interface SharedFiles {
  readonly stores: Set<AnnotationStore>;
  readonly queues: Map<string, Promise<void>>;
  /**
   * By key, for watched files only: the text this host last read from the
   * file or wrote to it. A watcher event that finds anything else is a
   * write from outside this host (another VS Code window).
   */
  readonly known: Map<string, string | undefined>;
}

const shared = new WeakMap<PdfAnnotationFiles, SharedFiles>();

/** Files sent to a viewer that it has not said it shows; older ones are forgotten. */
const MAX_UNANSWERED = 16;

/** What another editor's save left in the file kept for `sha256`. */
export interface StoreChange {
  sha256: string;
  revision: number;
  text: string | undefined;
}

function sharedFiles(files: PdfAnnotationFiles): SharedFiles {
  let found = shared.get(files);
  if (!found) {
    found = { stores: new Set(), queues: new Map(), known: new Map() };
    shared.set(files, found);
  }
  return found;
}

function enqueue<T>(
  files: SharedFiles,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const next = (files.queues.get(key) ?? Promise.resolve()).then(run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  files.queues.set(key, settled);
  void settled.then(() => {
    if (files.queues.get(key) === settled) {
      files.queues.delete(key);
    }
  });
  return next;
}

/**
 * The file of Lumiere's own annotations for the open PDF, named by the hash of
 * the bytes the viewer made them on (`annotation-store`), so annotating never
 * writes the PDF.
 *
 * The same PDF can be open in two editors, each sending every annotation it
 * shows. A save is therefore merged into the file by annotation
 * (`annotation-merge`), against what this editor last had from the host
 * (`base`): so a mark made or deleted in one editor is never undone by the
 * other's save. The other editors of the file in this host are then sent
 * what it holds. An editor in another window has its own host: the file's
 * watcher tells it, and it is sent the file the same way.
 */
export class AnnotationStore {
  private toldUnsupported = false;
  /** By hash: the file's text as this editor's viewer last had it from the host. */
  private readonly base = new Map<string, string | undefined>();
  private readonly shared: SharedFiles | undefined;
  /** Files sent to the viewer after another editor's save, by revision, until it shows them. */
  private readonly sent = new Map<
    number,
    { sha256: string; text: string | undefined }
  >();
  private revision = 0;
  /** The file of the bytes the viewer was last given, watched for other windows' saves. */
  private watched: { key: string; stop: () => void } | undefined;

  constructor(
    private readonly fileUri: string,
    private readonly files: PdfFiles,
    private readonly deps: {
      /** Whether a save about these bytes of this load may be written. */
      accepts: (load: number, sha256: string) => boolean;
      error: (message: string) => void;
      failed: (message: string) => void;
      /** Another editor changed the file kept for these bytes; it now holds `text`. */
      changed: (change: StoreChange) => void;
    },
  ) {
    this.shared = files.annotations && sharedFiles(files.annotations);
    this.shared?.stores.add(this);
  }

  /** The file's text for the PDF with these bytes; undefined when there is none or it cannot be read. */
  async read(sha256: string): Promise<string | undefined> {
    const store = this.files.annotations;
    const files = this.shared;
    if (!store || !files) {
      return undefined;
    }
    const key = this.keyOf(sha256);
    try {
      // After the saves before it: the viewer gets the file they wrote.
      const text = await enqueue(files, key, async () => {
        const found = await store.read(this.fileUri, sha256);
        if (store.watch) {
          files.known.set(key, found);
        }
        return found;
      });
      this.base.set(sha256, text);
      this.watch(store, sha256);
      return text;
    } catch (error) {
      this.deps.error(
        `Could not read the annotations of ${this.files.displayPath(this.fileUri)}: ${String(error)}`,
      );
      return undefined;
    }
  }

  /** Decided when the message arrives: a reload may start before its turn. */
  save(
    message: Extract<ViewerMessage, { type: "annotationStoreSave" }>,
  ): Promise<void> {
    if (!this.deps.accepts(message.load, message.sha256)) {
      return Promise.resolve();
    }
    const store = this.files.annotations;
    if (!store || !this.shared) {
      this.tellUnsupported();
      return Promise.resolve();
    }
    return enqueue(this.shared, this.keyOf(message.sha256), () =>
      this.saveNow(store, message.sha256, message.text ?? undefined),
    );
  }

  dispose(): void {
    this.unwatch();
    this.shared?.stores.delete(this);
  }

  private keyOf(sha256: string): string {
    try {
      return this.files.annotations?.key?.(this.fileUri, sha256) ?? sha256;
    } catch {
      // The read or write that follows fails the same way, and says why.
      return sha256;
    }
  }

  private async saveNow(
    store: PdfAnnotationFiles,
    sha256: string,
    mine: string | undefined,
  ): Promise<void> {
    const key = this.keyOf(sha256);
    let disk: string | undefined;
    let written: string | undefined;
    try {
      disk = await store.read(this.fileUri, sha256);
      const merged = mergeAnnotationFile(disk, this.base.get(sha256), mine);
      // Nothing of this editor's to add: writing would only put back what
      // was read, over whatever another window wrote since (a viewer saves
      // again after showing another window's marks).
      written = sameAnnotations(merged, disk) ? disk : merged;
      if (written !== disk) {
        await store.write(this.fileUri, sha256, written);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.deps.error(`Could not save PDF annotations: ${text}`);
      this.deps.failed(text);
      return;
    }
    this.base.set(sha256, mine);
    const known = this.shared?.known;
    // Another window wrote the file since this host last saw it, and its
    // watcher has not said so yet: this viewer has not seen that either.
    const isNewToAll = known?.has(key) === true && known.get(key) !== disk;
    if (known?.has(key)) {
      known.set(key, written);
    }
    // Nothing changed for the others: telling them would only echo.
    if (written === disk && !isNewToAll) {
      return;
    }
    this.tell(key, sha256, written, isNewToAll ? undefined : this);
  }

  /** Send the editors of the file `key` what it holds now, except `except`. */
  private tell(
    key: string,
    sha256: string,
    text: string | undefined,
    except?: AnnotationStore,
  ): void {
    for (const other of this.shared?.stores ?? []) {
      if (other !== except && other.keyOf(sha256) === key) {
        other.savedElsewhere(sha256, text);
      }
    }
  }

  /** Watch the file kept for `sha256`, and stop watching the one before. */
  private watch(store: PdfAnnotationFiles, sha256: string): void {
    const key = this.keyOf(sha256);
    if (!store.watch || this.watched?.key === key) {
      return;
    }
    this.unwatch();
    const stop = store.watch(this.fileUri, sha256, () => {
      void this.changedOnDisk(store, sha256, key);
    });
    this.watched = { key, stop };
  }

  private unwatch(): void {
    const watched = this.watched;
    if (!watched) {
      return;
    }
    this.watched = undefined;
    watched.stop();
    const isStillWatched = [...(this.shared?.stores ?? [])].some(
      (other) => other.watched?.key === watched.key,
    );
    if (!isStillWatched) {
      this.shared?.known.delete(watched.key);
    }
  }

  /**
   * The watcher says the file may have changed. In the queue, after this
   * host's own saves: a file as one of them left it is no news. Another
   * window's write is sent to every editor of the file here, and each
   * viewer merges it with what it has not saved yet (`showStoreFile`).
   */
  private changedOnDisk(
    store: PdfAnnotationFiles,
    sha256: string,
    key: string,
  ): Promise<void> {
    const files = this.shared;
    if (!files) {
      return Promise.resolve();
    }
    return enqueue(files, key, async () => {
      if (this.watched?.key !== key) {
        return;
      }
      const text = await store.read(this.fileUri, sha256);
      if (files.known.has(key) && files.known.get(key) === text) {
        return;
      }
      files.known.set(key, text);
      this.tell(key, sha256, text);
    }).catch((error: unknown) => {
      // The next save reads and merges the file again; nothing is lost.
      this.deps.error(
        `Could not read the annotations another window saved: ${String(error)}`,
      );
    });
  }

  /**
   * The viewer shows what `revision` sent it. Its base gains what the file
   * held then, and keeps what that lost (an annotation deleted elsewhere,
   * which this viewer may still show as it was: one it did not touch, so its
   * next save does not bring it back). In the queue: a save it sent before
   * showing the file is merged against the base it was made on.
   */
  shown(
    message: Extract<ViewerMessage, { type: "annotationStoreShown" }>,
  ): Promise<void> {
    const sent = this.sent.get(message.revision);
    if (
      !this.shared ||
      sent?.sha256 !== message.sha256 ||
      !this.deps.accepts(message.load, message.sha256)
    ) {
      return Promise.resolve();
    }
    for (const revision of this.sent.keys()) {
      if (revision <= message.revision) {
        this.sent.delete(revision);
      }
    }
    return enqueue(this.shared, this.keyOf(message.sha256), async () => {
      const base = this.base.get(message.sha256);
      this.base.set(
        message.sha256,
        mergeAnnotationFile(base, undefined, sent.text) ?? base,
      );
    });
  }

  /**
   * Another editor saved the file kept for `sha256`. The base changes only
   * when this viewer says it shows the new file (`shown`): a save it sends
   * before then must not delete what it has not seen.
   */
  private savedElsewhere(sha256: string, text: string | undefined): void {
    if (!this.base.has(sha256)) {
      return;
    }
    const revision = ++this.revision;
    this.sent.set(revision, { sha256, text });
    // Only the latest few can still be answered: a viewer answers in order.
    for (const old of this.sent.keys()) {
      if (old <= revision - MAX_UNANSWERED) {
        this.sent.delete(old);
      }
    }
    this.deps.changed({ sha256, revision, text });
  }

  private tellUnsupported(): void {
    if (!this.toldUnsupported) {
      this.toldUnsupported = true;
      this.deps.error(
        "Annotations on this PDF are not kept after it closes: this host has nowhere to store them.",
      );
    }
  }
}
