import { createHash } from "node:crypto";
import type { HostMessage, ViewerMessage } from "../../shared/messages";
import type { PdfFiles } from "../../shared/host";
import type { PdfSource } from "./source";

export type AnnotationDirty = "clean" | "saving" | "failed";

/** Collaborator for in-place annotation overwrite on the open PDF. */
export class AnnotationSave {
  dirty: AnnotationDirty = "clean";
  lastBytes: ArrayBuffer | undefined;
  /** Saves and Keep mine run one at a time, in the order they came. */
  private queue: Promise<void> = Promise.resolve();
  /**
   * The file's hashes during the viewer's current load: as loaded, then as
   * this editor wrote it. A viewer that saves again before the last result
   * reaches it still names an earlier one as its base. Set by `loaded` when
   * the bytes are sent, not read from the source later: by then a reload may
   * have replaced its hash.
   */
  private known = { load: Number.NaN, hashes: new Set<string>() };
  /**
   * Writes into the PDF the reader asked for (Save into This PDF, Retry) and
   * the viewer has not answered yet, for one load. The viewer is untrusted:
   * a PDF it sends unasked is never written.
   */
  private requested = { load: Number.NaN, count: 0 };

  constructor(
    private readonly fileUri: string,
    private readonly files: PdfFiles,
    private readonly source: PdfSource,
    private readonly deps: {
      isCurrentLoad: (load: number) => boolean;
      post: (message: HostMessage) => void;
      error: (message: string) => void;
      conflict: (payload: { data: ArrayBuffer; load: number }) => void;
      failed: (message: string) => void;
      saved: () => void;
    },
  ) {}

  markFailed(): void {
    this.dirty = "failed";
  }

  /** The reader asked the viewer of `load` for the PDF to write over the file. */
  request(load: number): void {
    if (this.requested.load !== load) {
      this.requested = { load, count: 0 };
    }
    this.requested.count++;
  }

  /** Use up one request of `load`; false when there is none. */
  private takeRequest(load: number): boolean {
    if (this.requested.load !== load || this.requested.count === 0) {
      return false;
    }
    this.requested.count--;
    return true;
  }

  keepMine(data: ArrayBuffer, load: number): Promise<void> {
    return this.enqueue(() => this.keepMineNow(data, load));
  }

  save(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
  ): Promise<void> {
    return this.enqueue(() => this.saveNow(message));
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The viewer was sent the bytes hashing to `sha256` as load `load`. */
  loaded(load: number, sha256: string): void {
    this.known = { load, hashes: new Set([sha256]) };
  }

  /** Whether `sha256` is the file as the viewer's load had it at some point. */
  knows(load: number, sha256: string): boolean {
    return this.known.load === load && this.known.hashes.has(sha256);
  }

  private wrote(load: number, sha256: string): void {
    this.source.acceptWrite(sha256);
    if (this.known.load === load) {
      this.known.hashes.add(sha256);
    }
  }

  private async keepMineNow(data: ArrayBuffer, load: number): Promise<void> {
    if (!this.deps.isCurrentLoad(load) || !this.files.writeAtomic) {
      return;
    }
    await this.write(this.files.writeAtomic, load, new Uint8Array(data));
  }

  private async saveNow(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
  ): Promise<void> {
    if (!this.deps.isCurrentLoad(message.load)) {
      return;
    }
    if (!this.takeRequest(message.load)) {
      this.deps.error(
        "The PDF viewer sent the PDF to write although it was not asked to; the file is left as it is.",
      );
      return;
    }
    this.lastBytes = message.data;
    if (!this.knows(message.load, message.baseSha256)) {
      this.reportConflict(
        message,
        "The PDF changed since this editor loaded it.",
      );
      return;
    }
    if (!this.files.writeAtomic) {
      this.dirty = "failed";
      this.deps.error("This host cannot overwrite PDF files in place.");
      this.deps.post({
        type: "annotationSaveResult",
        load: message.load,
        ok: false,
        reason: "error",
        message: "writeAtomic is unavailable",
      });
      return;
    }
    const diskMatches = await this.source.diskMatchesBase();
    // A reload during the check gave the viewer other bytes than these; a
    // conflict could no longer be settled with Keep mine.
    if (!this.deps.isCurrentLoad(message.load)) {
      return;
    }
    if (!diskMatches) {
      this.reportConflict(message, "The PDF was modified on disk.");
      return;
    }
    await this.write(
      this.files.writeAtomic,
      message.load,
      new Uint8Array(message.data),
    );
  }

  /** Write `bytes` over the file and tell the viewer whether it worked. */
  private async write(
    writeAtomic: NonNullable<PdfFiles["writeAtomic"]>,
    load: number,
    bytes: Uint8Array,
  ): Promise<void> {
    this.source.expectWrite(createHash("sha256").update(bytes).digest("hex"));
    this.dirty = "saving";
    try {
      const written = await writeAtomic(this.fileUri, bytes);
      this.wrote(load, written.sha256);
      this.dirty = "clean";
      this.deps.saved();
      this.deps.post({
        type: "annotationSaveResult",
        load,
        ok: true,
        sha256: written.sha256,
      });
    } catch (error) {
      this.dirty = "failed";
      const text = error instanceof Error ? error.message : String(error);
      this.deps.error(`Could not save PDF annotations: ${text}`);
      this.deps.failed(text);
      this.deps.post({
        type: "annotationSaveResult",
        load,
        ok: false,
        reason: "error",
        message: text,
      });
    }
  }

  private reportConflict(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
    text: string,
  ): void {
    this.deps.conflict({ data: message.data, load: message.load });
    this.deps.post({
      type: "annotationSaveResult",
      load: message.load,
      ok: false,
      reason: "conflict",
      message: text,
    });
  }
}
