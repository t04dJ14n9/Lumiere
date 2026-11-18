import { annotationKey } from "@embedpdf/engine-core/public";
import type {
  AnnotationCapability,
  AnnotationRef,
} from "@embedpdf/react/annotation";
import type { DocumentsCapability } from "@embedpdf/react/runtime";
import { AnnotationOwnership } from "../shared/annotation-ownership";
import {
  downloadPdf,
  exportStoreText,
  restoreStoredAnnotations,
} from "./annotation-persist";
import type { OutgoingMessage } from "./outbox";

/**
 * The write that brings back Lumiere's annotations. Its events carry this id as
 * `origin.transaction.id`, which tells the file's annotations from new ones.
 */
export const RESTORE_OP_ID = "lumiere-restore-annotations";

/** Where a session reads the load it belongs to and sends its messages. */
export interface SessionHost {
  post(message: OutgoingMessage): void;
  loadState():
    { load: number; sha256: string; annotations?: string } | undefined;
}

type Change = "create" | "update" | "delete";

/**
 * What the save session of one open document knows: which annotations are
 * Lumiere's, and the work in flight. Writes to the host run one at a time, in
 * the order they were asked for, and none starts before the file's own
 * annotations are back, or it would save a file without them.
 */
export class StoreSession {
  readonly ownership = new AnnotationOwnership();
  private chain: Promise<void> = Promise.resolve();
  private started = false;
  private saveQueued = false;
  /** The file could not be read back: saving would replace what is in it with less. */
  private fileLeftAlone = false;
  private markRestored: () => void = () => undefined;
  private readonly restored = new Promise<void>((resolve) => {
    this.markRestored = resolve;
  });

  constructor(
    private readonly annotation: AnnotationCapability,
    private readonly host: SessionHost,
  ) {}

  /** Bring back the file's annotations, once; `ready` is false when this document's could not be read. */
  restore(ready: boolean): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const text = ready ? this.host.loadState()?.annotations : undefined;
    void this.restoreText(text).finally(this.markRestored);
  }

  private async restoreText(text: string | undefined): Promise<void> {
    if (text === undefined) {
      return;
    }
    try {
      const restored = await restoreStoredAnnotations(
        this.annotation,
        text,
        RESTORE_OP_ID,
      );
      if (restored.kind === "unreadable") {
        this.leaveFileAlone("could not be read");
        return;
      }
      this.ownership.imported(
        restored.annotations.map((found) => annotationKey(found.ref)),
      );
      if (restored.lost > 0) {
        this.error(
          `${restored.lost} kept annotation(s) could not be restored; the next save leaves them out of the annotation file.`,
        );
      }
    } catch (error) {
      this.leaveFileAlone(`could not be restored (${describe(error)})`);
    }
  }

  private leaveFileAlone(problem: string): void {
    this.fileLeftAlone = true;
    this.error(
      `The annotation file kept for this PDF ${problem}. It is left as it is, and annotations made now are not saved to it.`,
    );
  }

  /** A change EmbedPDF has saved: Lumiere's go to the file, a PDF's own are reported. */
  committed(
    type: Change,
    refs: readonly AnnotationRef[],
    origin: { transaction?: { id: string } | undefined },
  ): void {
    const keys = refs.map(annotationKey);
    if (origin.transaction?.id === RESTORE_OP_ID) {
      this.ownership.imported(keys);
      return;
    }
    const owners = new Set(keys.map((key) => this.ownership.change(type, key)));
    if (owners.has("store")) {
      this.saveStore();
    }
    const load = this.host.loadState()?.load;
    if (owners.has("pdf") && load !== undefined) {
      this.host.post({ type: "annotationEmbeddedEdit", load });
    }
  }

  /** Annotations were read again: an Undo or Redo may have brought Lumiere's back. */
  resynced(): void {
    if (this.started) {
      this.saveStore();
    }
  }

  /** Save Lumiere's annotations; changes that come while a save is queued share it. */
  saveStore(): void {
    if (this.saveQueued || this.fileLeftAlone) {
      return;
    }
    this.saveQueued = true;
    this.run(
      async (state) => {
        // Known only once the file has been read, which a save waits for.
        if (this.fileLeftAlone) {
          return;
        }
        try {
          const text = await exportStoreText(this.annotation, this.ownership);
          this.host.post({
            type: "annotationStoreSave",
            load: state.load,
            sha256: state.sha256,
            text,
          });
        } catch (error) {
          this.failed(state.load, error);
        }
      },
      // A change from here on needs a save of its own: this one reads now.
      () => {
        this.saveQueued = false;
      },
    );
  }

  writePdf(documents: DocumentsCapability, to: "pdf" | "copy"): void {
    this.run(async (state) => {
      try {
        const data = await downloadPdf(documents);
        this.host.post(
          to === "pdf"
            ? {
                type: "annotationSave",
                load: state.load,
                baseSha256: state.sha256,
                data,
              }
            : { type: "annotationExport", load: state.load, data },
        );
      } catch (error) {
        this.failed(state.load, error);
      }
    });
  }

  /** Queue work for the load shown when it starts, once the file's annotations are back. */
  private run(
    task: (state: { load: number; sha256: string }) => Promise<void>,
    started: () => void = () => undefined,
  ): void {
    this.chain = this.chain
      .then(async () => {
        await this.restored;
        started();
        const state = this.host.loadState();
        if (state) {
          await task(state);
        }
      })
      .catch(() => undefined);
  }

  private failed(load: number, error: unknown): void {
    this.host.post({
      type: "annotationSaveFailed",
      load,
      message: describe(error),
    });
  }

  private error(message: string): void {
    this.host.post({ type: "error", message });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
