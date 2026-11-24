import { createHash } from "node:crypto";
import type { HostMessage, ViewerMessage } from "../../shared/messages";
import type { PdfFiles } from "../../shared/host";
import type { PdfSource } from "./source";

export type AnnotationDirty = "clean" | "saving" | "failed";

/** A PDF write the disk changed under: Keep mine writes `data` anyway. */
export interface PdfWriteConflict {
  data: ArrayBuffer;
  load: number;
  /** The viewer's number for the write, which its result names. */
  write: number;
}

/** Collaborator for in-place annotation overwrite on the open PDF. */
export class AnnotationSave {
  dirty: AnnotationDirty = "clean";
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
      conflict: (payload: PdfWriteConflict) => void;
      failed: (message: string) => void;
      saved: () => void;
      /** The PDF was rewritten: its bookmarks, keyed by the bytes it had, move to the new ones. */
      rewrote: (change: { from: string; to: string }) => void;
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

  keepMine(conflict: PdfWriteConflict): Promise<void> {
    return this.enqueue(() => this.keepMineNow(conflict));
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

  /**
   * Whether the file on disk is as the viewer's load had it: as loaded, or
   * as this editor wrote it since. Not the source's hash: a reload still
   * reading the annotation store has already replaced that with bytes the
   * viewer has not been sent.
   */
  private async diskIsKnown(load: number): Promise<boolean> {
    try {
      const disk = await this.source.diskHash();
      return disk === undefined || this.knows(load, disk);
    } catch {
      return false;
    }
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

  private async keepMineNow(conflict: PdfWriteConflict): Promise<void> {
    if (!this.deps.isCurrentLoad(conflict.load) || !this.files.writeAtomic) {
      return;
    }
    await this.write(
      this.files.writeAtomic,
      conflict,
      new Uint8Array(conflict.data),
    );
  }

  private async saveNow(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
  ): Promise<void> {
    if (!this.deps.isCurrentLoad(message.load)) {
      this.reportReloaded(message);
      return;
    }
    if (!this.takeRequest(message.load)) {
      this.deps.error(
        "The PDF viewer sent the PDF to write although it was not asked to; the file is left as it is.",
      );
      return;
    }
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
        write: message.write,
        ok: false,
        reason: "error",
        message: "writeAtomic is unavailable",
      });
      return;
    }
    const diskMatches = await this.diskIsKnown(message.load);
    // A reload during the check gave the viewer other bytes than these; a
    // conflict could no longer be settled with Keep mine.
    if (!this.deps.isCurrentLoad(message.load)) {
      this.reportReloaded(message);
      return;
    }
    if (!diskMatches) {
      this.reportConflict(message, "The PDF was modified on disk.");
      return;
    }
    await this.write(
      this.files.writeAtomic,
      message,
      new Uint8Array(message.data),
    );
  }

  /** Write `bytes` over the file and tell the viewer whether it worked. */
  private async write(
    writeAtomic: NonNullable<PdfFiles["writeAtomic"]>,
    { load, write }: { load: number; write: number },
    bytes: Uint8Array,
  ): Promise<void> {
    // The hash the PDF's bookmarks are keyed by, read before the write replaces it.
    const from = this.source.sha256;
    this.source.expectWrite(createHash("sha256").update(bytes).digest("hex"));
    this.dirty = "saving";
    let to: string | undefined;
    try {
      const written = await writeAtomic(this.fileUri, bytes);
      // The PDF is rewritten from here on, whatever is reported after it.
      to = written.sha256;
      this.wrote(load, written.sha256);
      this.dirty = "clean";
      this.deps.saved();
      this.deps.post({
        type: "annotationSaveResult",
        load,
        write,
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
        write,
        ok: false,
        reason: "error",
        message: text,
      });
    }
    // After the result: a listener that throws must not turn a written save into a failed one.
    if (from !== undefined && to !== undefined && from !== to) {
      this.deps.rewrote({ from, to });
    }
  }

  /**
   * A reload replaced the bytes this save was made on, so the write did not
   * happen. The viewer must hear that: with no result it keeps waiting. Not a
   * conflict: Keep mine is refused for a load that is no longer current, so a
   * conflict would never settle.
   */
  private reportReloaded(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
  ): void {
    this.deps.post({
      type: "annotationSaveResult",
      load: message.load,
      write: message.write,
      ok: false,
      reason: "error",
      message: "The PDF was reloaded before the annotations were saved.",
    });
  }

  private reportConflict(
    message: Extract<ViewerMessage, { type: "annotationSave" }>,
    text: string,
  ): void {
    this.deps.conflict({
      data: message.data,
      load: message.load,
      write: message.write,
    });
    this.deps.post({
      type: "annotationSaveResult",
      load: message.load,
      write: message.write,
      ok: false,
      reason: "conflict",
      message: text,
    });
  }
}
