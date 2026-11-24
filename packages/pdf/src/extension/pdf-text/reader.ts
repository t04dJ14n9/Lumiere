import { MAX_OUTLINE_PDF_BYTES, type OutlineFiles } from "../outlines/reader";
import type { PdfOpening, PdfTextEngine, QuoteRegion } from "./engine";

/** The size the outline reader opens, for the same reason: PDFium keeps what it opens in memory for good. */
export const MAX_TEXT_PDF_BYTES = MAX_OUTLINE_PDF_BYTES;

/** PDFs whose text is kept, least recently asked first out. */
const MAX_CACHED_PDFS = 4;

/** Why a PDF's text was not read. */
export type PdfRefusal =
  "missing" | "too-large" | "locked" | "copy-forbidden" | "unreadable";

export type PdfReading<T> =
  { ok: true; value: T } | { ok: false; reason: PdfRefusal };

/** What an agent is told about a PDF it asked for, after the file's name. */
export const REFUSAL_MESSAGES: Readonly<Record<PdfRefusal, string>> = {
  missing:
    "is missing, or is not inside this window's workspace folders (Lumiere reads the text of workspace PDFs only).",
  "too-large": `is larger than ${MAX_TEXT_PDF_BYTES / 2 ** 20} MB, which is more than Lumiere reads text from.`,
  locked: "needs a password, which the agent tools cannot enter.",
  "copy-forbidden":
    "forbids copying its text in its permissions, so Lumiere does not hand its text to an agent.",
  unreadable: "could not be read by PDFium (damaged, or not a PDF).",
};

/** The files the outline reader reads: the workspace's PDFs, by real path. */
export type PdfTextFiles = OutlineFiles;

export interface PdfTextReaderOptions {
  files: PdfTextFiles;
  /** Starts PDFium. Called once, when the first text is asked for. */
  engine: () => Promise<PdfTextEngine>;
  log: (message: string) => void;
}

interface Cached {
  stamp: string;
  reading: PdfReading<readonly string[]>;
}

/**
 * The text of PDFs in the workspace, for the agent bridge's tools, read by
 * the host's own PDFium: a PDF need not be open in a viewer. One PDFium
 * serves every request, one PDF at a time. A PDF's pages are read again only
 * when its modification time or size changes, so an agent that searches a
 * paper five times reads it once.
 */
export class PdfTextReader {
  private readonly cache = new Map<string, Cached>();
  private readonly pending = new Map<
    string,
    { stamp: string; reading: Promise<PdfReading<readonly string[]>> }
  >();
  private engine: Promise<PdfTextEngine> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: PdfTextReaderOptions) {}

  /**
   * The text of each page of the PDF at `uri` (index 0 is page 1). Never
   * rejects: a PDF that cannot be read says why.
   */
  async pages(uri: string): Promise<PdfReading<readonly string[]>> {
    const checked = await this.check(uri);
    if (!checked.ok) {
      return checked;
    }
    const { stamp } = checked.value;
    const cached = this.cache.get(uri);
    if (cached?.stamp === stamp) {
      // Asked for again: the last to go.
      this.cache.delete(uri);
      this.cache.set(uri, cached);
      return cached.reading;
    }
    const pending = this.pending.get(uri);
    if (pending?.stamp === stamp) {
      return pending.reading;
    }
    const reading = this.enqueue(() =>
      this.read(uri, (engine, bytes) => engine.pages(bytes)),
    );
    this.pending.set(uri, { stamp, reading });
    try {
      const found = await reading;
      this.remember(uri, { stamp, reading: found });
      return found;
    } finally {
      if (this.pending.get(uri)?.reading === reading) {
        this.pending.delete(uri);
      }
    }
  }

  /**
   * The text under each region of the PDF at `uri`, one string per region.
   * Not kept: a list of marks changes with every one the user adds.
   */
  async quotes(
    uri: string,
    regions: readonly QuoteRegion[],
  ): Promise<PdfReading<readonly string[]>> {
    const checked = await this.check(uri);
    if (!checked.ok) {
      return checked;
    }
    return this.enqueue(() =>
      this.read(uri, (engine, bytes) => engine.quotes(bytes, regions)),
    );
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

  /** The file's stamp, or why it will not be read: stat is all it costs. */
  private async check(uri: string): Promise<PdfReading<{ stamp: string }>> {
    if (this.disposed) {
      return refused("unreadable");
    }
    const stat = await this.options.files.stat(uri).catch(() => undefined);
    if (!stat) {
      return refused("missing");
    }
    if (stat.size > MAX_TEXT_PDF_BYTES) {
      return refused("too-large");
    }
    return { ok: true, value: { stamp: `${stat.mtime}:${stat.size}` } };
  }

  /**
   * Never rejects. A failure is remembered like a result by `pages`: the
   * same bytes fail the same way, and the file's stamp changes when they do.
   */
  private async read<T>(
    uri: string,
    use: (engine: PdfTextEngine, bytes: Uint8Array) => Promise<PdfOpening<T>>,
  ): Promise<PdfReading<T>> {
    if (this.disposed) {
      return refused("unreadable");
    }
    try {
      const bytes = await this.options.files.read(uri);
      // `dispose()` runs while the first read is in progress, before any
      // engine exists for it to stop; one started now would never be stopped.
      if (this.disposed) {
        return refused("unreadable");
      }
      this.engine ??= this.options.engine();
      const opening = await use(await this.engine, bytes);
      return opening.status === "ok"
        ? { ok: true, value: opening.value }
        : refused(opening.status);
    } catch (error) {
      this.options.log(`Could not read the text of ${uri}: ${String(error)}`);
      return refused("unreadable");
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

function refused(reason: PdfRefusal): { ok: false; reason: PdfRefusal } {
  return { ok: false, reason };
}
