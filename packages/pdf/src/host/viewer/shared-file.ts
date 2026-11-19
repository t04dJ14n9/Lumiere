import { createHash } from "node:crypto";
import type { PdfFiles } from "../../shared/host";

/** Let a file write settle before reloading the PDF. */
const RELOAD_DELAY_MS = 150;

/**
 * The most a PDF may weigh for the viewer to open it, unless the host says
 * otherwise (`PdfFiles.maxBytes`). The viewer is sent the whole file and
 * EmbedPDF opens it from memory (it cannot load by range: see
 * docs/large-pdfs.md), so the extension host, the message and the webview
 * each hold a copy: past this, opening the file risks the webview rather
 * than only being slow.
 */
export const MAX_PDF_BYTES = 512 * 2 ** 20;

/** Hashed in slices, so a large PDF does not hold up the host's other work. */
const HASH_SLICE_BYTES = 16 * 2 ** 20;

/** One read of the file: its bytes and their hash. */
export interface PdfBytes {
  data: ArrayBuffer;
  sha256: string;
}

/** A read of the file: its bytes, or why there are none. */
export type FileRead = { bytes: PdfBytes } | { error: string };

/**
 * One PDF file as every editor of it in this host sees it: one watcher, and
 * one read and hash per change on disk, handed to each editor (`subscribe`).
 * Editors that read it at the same time share that read too. A read that
 * has finished is never handed out again: the next one is the file's.
 */
export class SharedPdfFile {
  private readonly subscribers = new Set<(read: FileRead) => void>();
  private inFlight: Promise<FileRead> | undefined;
  private stopWatching: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by each change: only the read of the latest one is handed out. */
  private generation = 0;

  constructor(
    private readonly uri: string,
    private readonly files: PdfFiles,
    private readonly forget: () => void,
  ) {}

  /** The file now, or why it cannot be read. Never rejects. */
  read(): Promise<FileRead> {
    if (!this.inFlight) {
      const read = this.readNow();
      this.inFlight = read;
      void read.finally(() => {
        if (this.inFlight === read) {
          this.inFlight = undefined;
        }
      });
    }
    return this.inFlight;
  }

  /**
   * Hand `changed` each settled change on disk, read once for every
   * subscriber. The file is watched while anyone subscribes.
   */
  subscribe(changed: (read: FileRead) => void): () => void {
    this.subscribers.add(changed);
    this.stopWatching ??= this.files.watch(this.uri, () => this.onChange());
    return () => {
      this.subscribers.delete(changed);
      if (this.subscribers.size === 0) {
        this.generation++;
        clearTimeout(this.timer);
        this.stopWatching?.();
        this.stopWatching = undefined;
        this.forget();
      }
    };
  }

  private onChange(): void {
    // A read under way began before this change: later reads start again.
    this.inFlight = undefined;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.readChange(), RELOAD_DELAY_MS);
  }

  private async readChange(): Promise<void> {
    const generation = this.generation;
    const read = await this.read();
    if (generation !== this.generation) {
      return;
    }
    for (const changed of [...this.subscribers]) {
      changed(read);
    }
  }

  private async readNow(): Promise<FileRead> {
    const name = this.files.displayPath(this.uri);
    const limit = this.files.maxBytes ?? MAX_PDF_BYTES;
    try {
      const size = await this.files.size?.(this.uri);
      if (size !== undefined && size > limit) {
        return { error: tooLarge(name, limit) };
      }
      const bytes = await this.files.read(this.uri);
      if (bytes.byteLength > limit) {
        return { error: tooLarge(name, limit) };
      }
      return {
        bytes: {
          data: standaloneBuffer(bytes),
          sha256: await hashInSlices(bytes),
        },
      };
    } catch (error) {
      return { error: `Could not read ${name}: ${String(error)}` };
    }
  }
}

const sharedFiles = new WeakMap<PdfFiles, Map<string, SharedPdfFile>>();

/** The file at `uri` as this host's `files` reads it, shared by its editors. */
export function sharedPdfFile(files: PdfFiles, uri: string): SharedPdfFile {
  let byUri = sharedFiles.get(files);
  if (!byUri) {
    byUri = new Map();
    sharedFiles.set(files, byUri);
  }
  const found = byUri.get(uri);
  if (found) {
    return found;
  }
  const file = new SharedPdfFile(uri, files, () => {
    if (byUri.get(uri) === file) {
      byUri.delete(uri);
    }
  });
  byUri.set(uri, file);
  return file;
}

function tooLarge(name: string, limit: number): string {
  const size =
    limit % 2 ** 20 === 0 ? `${limit / 2 ** 20} MB` : `${limit} bytes`;
  return `${name} is larger than ${size}, the most Lumiere PDF opens.`;
}

async function hashInSlices(bytes: Uint8Array): Promise<string> {
  const hash = createHash("sha256");
  for (let start = 0; start < bytes.byteLength; start += HASH_SLICE_BYTES) {
    if (start > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    hash.update(bytes.subarray(start, start + HASH_SLICE_BYTES));
  }
  return hash.digest("hex");
}

/** The bytes as an ArrayBuffer of their own, which the webview can take over. */
function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);
}
