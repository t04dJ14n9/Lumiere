import type { OutlineSection } from "../../shared/outline-sections";
import type { OutlineEngine } from "./engine";

/** Larger PDFs are not opened: PDFium would keep their size in memory for good. */
export const MAX_OUTLINE_PDF_BYTES = 200 * 1024 * 1024;

/** PDFs whose sections are kept, least recently asked first out. */
const MAX_CACHED_PDFS = 32;

/** Where the PDFs are, as the editor's file system sees them. */
export interface OutlineFiles {
  /** Undefined when the file does not exist or cannot be read. */
  stat(uri: string): Promise<{ mtime: number; size: number } | undefined>;
  read(uri: string): Promise<Uint8Array>;
}

export interface OutlineReaderOptions {
  files: OutlineFiles;
  /** Starts PDFium. Called once, when the first outline is asked for. */
  engine: () => Promise<OutlineEngine>;
  log: (message: string) => void;
}

interface Cached {
  stamp: string;
  sections: readonly OutlineSection[];
}

/**
 * The bookmarks of PDFs in the workspace, for suggesting them to notes. One
 * PDFium serves every request, one PDF at a time. A PDF is read again only
 * when its modification time or size changes, so typing after `[[paper.pdf#`
 * costs one `stat` per key.
 */
export class PdfOutlineReader {
  private readonly cache = new Map<string, Cached>();
  private readonly reading = new Map<
    string,
    { stamp: string; sections: Promise<readonly OutlineSection[]> }
  >();
  private engine: Promise<OutlineEngine> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: OutlineReaderOptions) {}

  /**
   * The sections of the PDF at `uri`, in document order. Empty when the PDF
   * has no usable bookmarks, is too large, is encrypted or cannot be read:
   * the reader never rejects.
   */
  async sections(uri: string): Promise<readonly OutlineSection[]> {
    const stat = await this.options.files.stat(uri).catch(() => undefined);
    if (!stat || stat.size > MAX_OUTLINE_PDF_BYTES || this.disposed) {
      return [];
    }
    const stamp = `${stat.mtime}:${stat.size}`;
    const cached = this.cache.get(uri);
    if (cached?.stamp === stamp) {
      // Asked for again: the last to go.
      this.cache.delete(uri);
      this.cache.set(uri, cached);
      return cached.sections;
    }
    const reading = this.reading.get(uri);
    if (reading?.stamp === stamp) {
      return reading.sections;
    }
    const sections = this.enqueue(() => this.read(uri));
    this.reading.set(uri, { stamp, sections });
    try {
      const found = await sections;
      this.remember(uri, { stamp, sections: found });
      return found;
    } finally {
      if (this.reading.get(uri)?.sections === sections) {
        this.reading.delete(uri);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    const engine = this.engine;
    this.engine = undefined;
    // After the read in progress, which still uses it.
    void this.queue
      .then(() => engine)
      .then((started) => started?.dispose())
      .catch(() => undefined);
  }

  /**
   * Never rejects. A failure is remembered like a result: the same bytes fail
   * the same way, and the file's stamp changes when they do.
   */
  private async read(uri: string): Promise<readonly OutlineSection[]> {
    if (this.disposed) {
      return [];
    }
    try {
      const bytes = await this.options.files.read(uri);
      this.engine ??= this.options.engine();
      return await (await this.engine).sections(bytes);
    } catch (error) {
      this.options.log(
        `Could not read the outline of ${uri}: ${String(error)}`,
      );
      return [];
    }
  }

  /** One at a time, so that PDFium holds one PDF's bytes at once. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private remember(uri: string, entry: Cached): void {
    this.cache.delete(uri);
    this.cache.set(uri, entry);
    if (this.cache.size > MAX_CACHED_PDFS) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
