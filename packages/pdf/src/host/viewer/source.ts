import { createHash } from "node:crypto";
import type { PdfFiles } from "../../shared/host";

/** Let a file write settle before reloading the PDF. */
const RELOAD_DELAY_MS = 150;

/** One read of the file: its bytes and their hash. */
export interface PdfBytes {
  data: ArrayBuffer;
  sha256: string;
}

export interface SourceEvents {
  /** The file changed on disk and has settled. */
  changed(): void;
  /** A read failed; the message says which file and why. */
  failed(message: string): void;
}

/**
 * The PDF file behind one editor: reads it, hashes it, and watches it for
 * changes.
 *
 * Invariant: `sha256` is the hash of the bytes most recently handed to the
 * viewer, and a slow read never replaces a newer one (each read has a
 * generation; only the latest may finish).
 */
export class PdfSource {
  sha256: string | undefined;
  private expectedWrite: string | undefined;
  private generation = 0;
  private watchGeneration = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** What a watched change read, for the reload it starts. */
  private changedBytes: PdfBytes | undefined;
  private readonly stopWatching: () => void;

  constructor(
    readonly uri: string,
    private readonly files: PdfFiles,
    private readonly events: SourceEvents,
  ) {
    this.stopWatching = files.watch(uri, () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => void this.onWatchedChange(),
        RELOAD_DELAY_MS,
      );
    });
  }

  expectWrite(sha256: string): void {
    this.expectedWrite = sha256;
  }

  /**
   * The file's hash on disk now; undefined when this host cannot hash
   * files. Rejects when the file cannot be read.
   */
  async diskHash(): Promise<string | undefined> {
    return this.files.hash ? await this.files.hash(this.uri) : undefined;
  }

  acceptWrite(sha256: string): void {
    this.sha256 = sha256;
    this.expectedWrite = sha256;
  }

  /** Start a new read; resolves `undefined` if a newer read started meanwhile or it failed. */
  async read(): Promise<PdfBytes | undefined> {
    const generation = ++this.generation;
    const ready = this.changedBytes;
    this.changedBytes = undefined;
    if (ready) {
      this.sha256 = ready.sha256;
      return ready;
    }
    const read = await this.readNow();
    if (!read || generation !== this.generation) {
      return undefined;
    }
    this.sha256 = read.sha256;
    return read;
  }

  dispose(): void {
    // A read in flight finishes into a stale generation and is dropped.
    this.generation++;
    this.watchGeneration++;
    this.changedBytes = undefined;
    clearTimeout(this.timer);
    this.stopWatching();
  }

  /**
   * The file's bytes and hash now; undefined when it cannot be read, which
   * is reported when `report` says so.
   */
  private async readNow(report = true): Promise<PdfBytes | undefined> {
    let bytes: Uint8Array;
    try {
      bytes = await this.files.read(this.uri);
    } catch (error) {
      if (report) {
        this.events.failed(
          `Could not read ${this.files.displayPath(this.uri)}: ${String(error)}`,
        );
      }
      return undefined;
    }
    return {
      data: standaloneBuffer(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  /**
   * The file changed on disk: read it once, and hand those same bytes to
   * the reload (`read`) rather than reading and hashing the file twice.
   */
  private async onWatchedChange(): Promise<void> {
    // Its own count: a reload already reading goes on, and the newer bytes
    // found here start the next one.
    const generation = ++this.watchGeneration;
    const read = await this.readNow(false);
    if (generation !== this.watchGeneration) {
      return;
    }
    // Unreadable (deleted, locked): the reload reads again and says why.
    if (read) {
      // Keep expectedWrite: atomic rename often fires create+change, and
      // clearing after the first event lets the second reload the viewer
      // (wiping EmbedPDF History so Undo Annotation no-ops). Bytes the
      // viewer already has (a touch, a sync) need no reload either.
      if (read.sha256 === this.expectedWrite || read.sha256 === this.sha256) {
        this.sha256 = read.sha256;
        return;
      }
      this.changedBytes = read;
    }
    this.events.changed();
  }
}

/** The bytes as an ArrayBuffer of their own, which the webview can take over. */
function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);
}
