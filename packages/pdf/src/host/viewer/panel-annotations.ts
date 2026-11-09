import type { AnnotationViewerMessage } from "../../shared/annotation-messages";
import type { HostMessage } from "../../shared/messages";
import { Emitter, type Subscription } from "../events";
import { AnnotationSave } from "./annotation-save";
import { AnnotationStore } from "./annotation-store";
import type { ViewerPanelHost } from "./panel-types";
import type { PdfSource } from "./source";

/**
 * One editor's annotations on the host: Lumiere's own kept in a file outside
 * the PDF (`AnnotationStore`), and the PDF overwritten with them only when
 * the reader asks (`AnnotationSave`), with the events the extension shows.
 */
export class PanelAnnotations implements Subscription {
  /** Disk diverged from the editor's base bytes while saving into the PDF. */
  readonly conflict = new Emitter<{ data: ArrayBuffer; load: number }>();
  /** A save failed (I/O error). */
  readonly failed = new Emitter<string>();
  /** The viewer sent the PDF with its annotations for Export Annotated Copy. */
  readonly exported = new Emitter<ArrayBuffer>();
  /** An annotation that is part of the PDF changed; only saving into the PDF keeps that. */
  readonly embeddedEdit = new Emitter<void>();
  private readonly save: AnnotationSave;
  private readonly store: AnnotationStore;
  /** Where the save that failed last was going: Retry repeats that one. */
  private failure: "file" | "pdf" = "file";

  constructor(
    fileUri: string,
    private readonly host: ViewerPanelHost,
    source: PdfSource,
    private readonly deps: {
      isCurrentLoad: (load: number) => boolean;
      post: (message: HostMessage) => void;
    },
  ) {
    this.save = new AnnotationSave(fileUri, host.files, source, {
      isCurrentLoad: deps.isCurrentLoad,
      post: deps.post,
      error: (message) => host.error(message),
      conflict: (payload) => this.conflict.fire(payload),
      failed: (message) => this.fail("pdf", message),
      saved: () => {
        this.failure = "file";
      },
    });
    this.store = new AnnotationStore(fileUri, host.files, source, {
      isCurrentLoad: deps.isCurrentLoad,
      error: (message) => host.error(message),
      failed: (message) => this.fail("file", message),
    });
  }

  /** The text of the annotation file kept for these bytes, if any. */
  read(sha256: string): Promise<string | undefined> {
    return this.store.read(sha256);
  }

  keepMine(data: ArrayBuffer, load: number): Promise<void> {
    return this.save.keepMine(data, load);
  }

  /** Whether the save that failed last wrote the PDF, so Retry must write it again. */
  get retryWritesPdf(): boolean {
    return this.failure === "pdf";
  }

  /** Apply an annotation message from the viewer. */
  async handle(message: AnnotationViewerMessage): Promise<void> {
    switch (message.type) {
      case "annotationSave":
        await this.save.save(message);
        return;
      case "annotationStoreSave":
        await this.store.save(message);
        return;
      case "annotationSaveFailed":
        if (this.deps.isCurrentLoad(message.load)) {
          this.save.markFailed();
          this.host.error(`Could not save PDF annotations: ${message.message}`);
          this.fail("file", message.message);
        }
        return;
      case "annotationExport":
        if (this.deps.isCurrentLoad(message.load)) {
          this.exported.fire(message.data);
        }
        return;
      case "annotationEmbeddedEdit":
        if (this.deps.isCurrentLoad(message.load)) {
          this.embeddedEdit.fire();
        }
        return;
    }
  }

  private fail(failure: "file" | "pdf", message: string): void {
    this.failure = failure;
    this.failed.fire(message);
  }

  dispose(): void {
    this.conflict.dispose();
    this.failed.dispose();
    this.exported.dispose();
    this.embeddedEdit.dispose();
  }
}
