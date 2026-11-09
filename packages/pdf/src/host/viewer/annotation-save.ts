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
   * reaches it still names an earlier one as its base.
   */
  private known = { load: Number.NaN, hashes: new Set<string>() };

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

  /** Whether `base` is the file as the viewer's load had it at some point. */
  private isKnownBase(load: number, base: string): boolean {
    if (this.known.load !== load) {
      const loaded = this.source.sha256;
      this.known = { load, hashes: new Set(loaded ? [loaded] : []) };
    }
    return this.known.hashes.has(base);
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
    this.lastBytes = message.data;
    if (!this.isKnownBase(message.load, message.baseSha256)) {
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
