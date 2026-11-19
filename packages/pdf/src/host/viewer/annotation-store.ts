import type { PdfAnnotationFiles, PdfFiles } from "../../shared/host";
import type { ViewerMessage } from "../../shared/messages";
import { mergeAnnotationFile } from "../../shared/annotation-merge";

/**
 * The editors whose annotation files one host's `PdfAnnotationFiles` keeps,
 * and the saves to each file (by the PDF's hash, which names it) in the
 * order they came: two editors of one PDF never read, merge and write the
 * same file at once.
 */
interface SharedFiles {
  readonly stores: Set<AnnotationStore>;
  readonly queues: Map<string, Promise<void>>;
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
    found = { stores: new Set(), queues: new Map() };
    shared.set(files, found);
  }
  return found;
}

function enqueue<T>(
  files: SharedFiles,
  sha256: string,
  run: () => Promise<T>,
): Promise<T> {
  const next = (files.queues.get(sha256) ?? Promise.resolve()).then(run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  files.queues.set(sha256, settled);
  void settled.then(() => {
    if (files.queues.get(sha256) === settled) {
      files.queues.delete(sha256);
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
 * other's save. The other editors of the file are then sent what it holds.
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
    if (!store || !this.shared) {
      return undefined;
    }
    try {
      // After the saves before it: the viewer gets the file they wrote.
      const text = await enqueue(this.shared, sha256, () =>
        store.read(this.fileUri, sha256),
      );
      this.base.set(sha256, text);
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
    return enqueue(this.shared, message.sha256, () =>
      this.saveNow(store, message.sha256, message.text ?? undefined),
    );
  }

  dispose(): void {
    this.shared?.stores.delete(this);
  }

  private async saveNow(
    store: PdfAnnotationFiles,
    sha256: string,
    mine: string | undefined,
  ): Promise<void> {
    let disk: string | undefined;
    let merged: string | undefined;
    try {
      disk = await store.read(this.fileUri, sha256);
      merged = mergeAnnotationFile(disk, this.base.get(sha256), mine);
      await store.write(this.fileUri, sha256, merged);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.deps.error(`Could not save PDF annotations: ${text}`);
      this.deps.failed(text);
      return;
    }
    this.base.set(sha256, mine);
    // Nothing changed for the others: telling them would only echo.
    if (merged === disk) {
      return;
    }
    for (const other of this.shared?.stores ?? []) {
      if (other !== this) {
        other.savedElsewhere(sha256, merged);
      }
    }
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
    return enqueue(this.shared, message.sha256, async () => {
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
