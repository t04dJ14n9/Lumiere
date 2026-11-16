import type { AnnotationViewerMessage } from "../../shared/annotation-messages";
import type { HostMessage } from "../../shared/messages";
import { Emitter, type Subscription } from "../events";
import { AnnotationSave, type PdfWriteConflict } from "./annotation-save";
import { AnnotationStore } from "./annotation-store";
import type { ViewerLoads } from "./loads";
import type { ViewerPanelHost } from "./panel-types";
import type { PdfSource } from "./source";

/**
 * One editor's annotations on the host: Lumiere's own kept in a file outside
 * the PDF (`AnnotationStore`), and the PDF overwritten with them only when
 * the reader asks (`AnnotationSave`), with the events the extension shows.
 */
export class PanelAnnotations implements Subscription {
  /** Disk diverged from the editor's base bytes while saving into the PDF. */
  readonly conflict = new Emitter<PdfWriteConflict>();
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
      /** Which messages are about the bytes the viewer shows. */
      loads: Pick<ViewerLoads, "isCurrent" | "acceptsStoreSave">;
      post: (message: HostMessage) => void;
    },
  ) {
    this.save = new AnnotationSave(fileUri, host.files, source, {
      isCurrentLoad: (load) => deps.loads.isCurrent(load),
      post: deps.post,
      error: (message) => host.error(message),
      conflict: (payload) => this.conflict.fire(payload),
      failed: (message) => this.fail("pdf", message),
      saved: () => {
        this.failure = "file";
      },
    });
    this.store = new AnnotationStore(fileUri, host.files, {
      // Only a hash the viewer was given names a file: it is untrusted.
      accepts: (load, sha256) =>
        deps.loads.acceptsStoreSave(load) && this.save.knows(load, sha256),
      error: (message) => host.error(message),
      failed: (message) => this.fail("file", message),
    });
  }

  /** The viewer is sent the bytes hashing to `sha256` as load `load`. */
  loaded(load: number, sha256: string): void {
    this.save.loaded(load, sha256);
  }

  /** The text of the annotation file kept for these bytes, if any. */
  read(sha256: string): Promise<string | undefined> {
    return this.store.read(sha256);
  }

  /** The reader asked the viewer of `load` for the PDF to write over the file. */
  requestPdfWrite(load: number): void {
    this.save.request(load);
  }

  keepMine(conflict: PdfWriteConflict): Promise<void> {
    return this.save.keepMine(conflict);
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
        if (this.deps.loads.isCurrent(message.load)) {
          this.save.markFailed();
          this.host.error(`Could not save PDF annotations: ${message.message}`);
          this.fail("file", message.message);
        }
        return;
      case "annotationExport":
        if (this.deps.loads.isCurrent(message.load)) {
          this.exported.fire(message.data);
        }
        return;
      case "annotationEmbeddedEdit":
        if (this.deps.loads.isCurrent(message.load)) {
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
