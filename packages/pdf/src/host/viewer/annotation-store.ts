import type { PdfFiles } from "../../shared/host";
import type { ViewerMessage } from "../../shared/messages";
import type { PdfSource } from "./source";

/**
 * The file of Lumiere's own annotations for the open PDF, named by the hash of
 * the bytes the viewer has (`annotation-store`), so annotating never writes
 * the PDF. Saves run one at a time, in the order they came.
 */
export class AnnotationStore {
  private queue: Promise<void> = Promise.resolve();
  private toldUnsupported = false;

  constructor(
    private readonly fileUri: string,
    private readonly files: PdfFiles,
    private readonly source: PdfSource,
    private readonly deps: {
      isCurrentLoad: (load: number) => boolean;
      error: (message: string) => void;
      failed: (message: string) => void;
    },
  ) {}

  /** The file's text for the PDF with these bytes; undefined when there is none or it cannot be read. */
  async read(sha256: string): Promise<string | undefined> {
    try {
      return await this.files.annotations?.read(this.fileUri, sha256);
    } catch (error) {
      this.deps.error(
        `Could not read the annotations of ${this.files.displayPath(this.fileUri)}: ${String(error)}`,
      );
      return undefined;
    }
  }

  save(
    message: Extract<ViewerMessage, { type: "annotationStoreSave" }>,
  ): Promise<void> {
    const next = this.queue.then(() => this.saveNow(message));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async saveNow(
    message: Extract<ViewerMessage, { type: "annotationStoreSave" }>,
  ): Promise<void> {
    const sha256 = this.source.sha256;
    if (!this.deps.isCurrentLoad(message.load) || !sha256) {
      return;
    }
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
      await store.write(this.fileUri, sha256, message.text ?? undefined);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.deps.error(`Could not save PDF annotations: ${text}`);
      this.deps.failed(text);
    }
  }
}
