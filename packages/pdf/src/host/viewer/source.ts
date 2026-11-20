import type { PdfFiles } from "../../shared/host";
import {
  sharedPdfFile,
  type FileRead,
  type PdfBytes,
  type SharedPdfFile,
} from "./shared-file";

export { MAX_PDF_BYTES, type PdfBytes } from "./shared-file";

export interface SourceEvents {
  /** The file changed on disk and has settled. */
  changed(): void;
  /** A read failed; the message says which file and why. */
  failed(message: string): void;
}

/**
 * The PDF file behind one editor: reads it, hashes it, and watches it for
 * changes, through the file every editor of it in this host shares
 * (`shared-file.ts`): one watcher, and one read and hash per change.
 *
 * Invariant: `sha256` is the hash of the bytes most recently handed to the
 * viewer, and a slow read never replaces a newer one (each read has a
 * generation; only the latest may finish).
 */
export class PdfSource {
  sha256: string | undefined;
  private expectedWrite: string | undefined;
  private generation = 0;
  /** What a watched change read, for the reload it starts. */
  private changedBytes: PdfBytes | undefined;
  private readonly file: SharedPdfFile;
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    readonly uri: string,
    private readonly files: PdfFiles,
    private readonly events: SourceEvents,
  ) {
    this.file = sharedPdfFile(files, uri);
    this.unsubscribe = this.file.subscribe((read) =>
      this.onWatchedChange(read),
    );
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
    const read = await this.file.read();
    if ("error" in read) {
      if (!this.disposed) {
        this.events.failed(read.error);
      }
      return undefined;
    }
    if (generation !== this.generation) {
      return undefined;
    }
    this.sha256 = read.bytes.sha256;
    return read.bytes;
  }

  dispose(): void {
    // A read in flight finishes into a stale generation and is dropped.
    this.disposed = true;
    this.generation++;
    this.changedBytes = undefined;
    this.unsubscribe();
  }

  /**
   * The file changed on disk and was read once for every editor of it: hand
   * those bytes to the reload (`read`) rather than reading the file again.
   */
  private onWatchedChange(read: FileRead): void {
    // Unreadable (deleted, locked): the reload reads again and says why.
    if ("bytes" in read) {
      const { sha256 } = read.bytes;
      // Keep expectedWrite: atomic rename often fires create+change, and
      // clearing after the first event lets the second reload the viewer
      // (wiping EmbedPDF History so Undo Annotation no-ops). Bytes the
      // viewer already has (a touch, a sync) need no reload either.
      if (sha256 === this.expectedWrite || sha256 === this.sha256) {
        this.sha256 = sha256;
        return;
      }
      this.changedBytes = read.bytes;
    }
    this.events.changed();
  }
}
