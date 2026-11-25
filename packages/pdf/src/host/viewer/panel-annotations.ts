import { t } from "@workshop/l10n";
import type { AnnotationViewerMessage } from "../../shared/annotation-messages";
import type { HostMessage } from "../../shared/messages";
import { Emitter, type Subscription } from "../events";
import { AnnotationSave, type PdfWriteConflict } from "./annotation-save";
import { AnnotationStore, type StoreChange } from "./annotation-store";
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
  /** The PDF was rewritten by a save into it: the bytes it had are replaced by these. */
  readonly rewritten = new Emitter<{ from: string; to: string }>();
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
      loads: Pick<ViewerLoads, "current" | "isCurrent" | "acceptsStoreSave">;
      post: (message: HostMessage) => void;
    },
  ) {
    this.save = new AnnotationSave(fileUri, host.files, source, {
      isCurrentLoad: (load) => deps.loads.isCurrent(load),
      post: deps.post,
      error: (message) => host.error(message),
      conflict: (payload) => this.conflict.fire(payload),
      rewrote: (change) => this.rewritten.fire(change),
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
      changed: (change) => this.storeChanged(change),
    });
  }

  /** Another editor of the PDF saved its annotations: show this viewer what the file holds, if it shows those bytes. */
  private storeChanged({ sha256, revision, text }: StoreChange): void {
    const load = this.deps.loads.current;
    if (!this.deps.loads.isCurrent(load) || !this.save.knows(load, sha256)) {
      return;
    }
    this.deps.post({
      type: "annotationStoreChanged",
      load,
      sha256,
      revision,
      text: text ?? null,
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
      case "annotationStoreShown":
        await this.store.shown(message);
        return;
      case "annotationSaveFailed":
        if (this.deps.loads.isCurrent(message.load)) {
          this.save.markFailed();
          this.host.error(
            t("Could not save PDF annotations: {0}", message.message),
          );
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
    this.store.dispose();
    this.conflict.dispose();
    this.rewritten.dispose();
    this.failed.dispose();
    this.exported.dispose();
    this.embeddedEdit.dispose();
  }
}
