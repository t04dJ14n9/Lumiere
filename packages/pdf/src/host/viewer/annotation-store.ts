import type { PdfFiles } from "../../shared/host";
import type { ViewerMessage } from "../../shared/messages";
/**
 * The file of Lumiere's own annotations for the open PDF, named by the hash of
 * the bytes the viewer made them on (`annotation-store`), so annotating never
 * writes the PDF. Saves run one at a time, in the order they came, and a read
 * waits for the saves before it.
 */
export class AnnotationStore {
  private queue: Promise<void> = Promise.resolve();
  private toldUnsupported = false;

  constructor(
    private readonly fileUri: string,
    private readonly files: PdfFiles,
    private readonly deps: {
      /** Whether a save about these bytes of this load may be written. */
      accepts: (load: number, sha256: string) => boolean;
      error: (message: string) => void;
      failed: (message: string) => void;
    },
  ) {}

  /** The file's text for the PDF with these bytes; undefined when there is none or it cannot be read. */
  async read(sha256: string): Promise<string | undefined> {
    await this.queue;
    try {
      return await this.files.annotations?.read(this.fileUri, sha256);
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
    const next = this.queue.then(() => this.saveNow(message));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async saveNow(
    message: Extract<ViewerMessage, { type: "annotationStoreSave" }>,
  ): Promise<void> {
    const store = this.files.annotations;
    if (!store) {
      if (!this.toldUnsupported) {
        this.toldUnsupported = true;
        this.deps.error(
          "Annotations on this PDF are not kept after it closes: this host has nowhere to store them.",
        );
      }
      return;
    }
    try {
      await store.write(
        this.fileUri,
        message.sha256,
        message.text ?? undefined,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.deps.error(`Could not save PDF annotations: ${text}`);
      this.deps.failed(text);
    }
  }
}
