/**
 * The PDFs that embeds show, fetched and opened once per file however many
 * embeds show it. Ten embeds of one 40 MB PDF used to make ten fetches and
 * hold ten copies, and each page turn opened the document again (PDFium
 * parsing the whole file on the editor's thread). Now an embed's page turn
 * only renders the page of the document already open.
 *
 * An entry lives while an embed that asked for it does (until its pass's
 * `signal` aborts); the last one to go stops a fetch still running, or
 * closes the document. The fetched bytes are let go once the engine has
 * opened them (it keeps its own copy). `forgetPdfDocuments` drops every
 * entry when files change, so the next embed opens the file as it is now;
 * embeds still showing an old one close it when they go.
 *
 * The engine runs on the editor's thread, not in a worker as the PDF
 * viewer's does: the editor page allows no workers (its content security
 * policy has no `worker-src`, so `default-src 'none'` applies), and the
 * viewer's worker is a separate script that page does not load.
 */

/** One page drawn for an embed. */
export interface RenderedPdfPage {
  readonly pageCount: number;
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** A PDF open in the engine, as embeds use it. */
export interface OpenedPdf {
  readonly pageCount: number;
  /** Draw a 1-based page (clamped to the document) about `targetWidth` pixels wide. */
  render(page: number, targetWidth: number): Promise<RenderedPdfPage>;
  close(): Promise<void>;
}

export type LoadPdfBytes = (
  url: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;

export type OpenPdf = (bytes: Uint8Array) => Promise<OpenedPdf>;

interface Entry {
  readonly document: Promise<OpenedPdf>;
  readonly controller: AbortController;
  users: number;
}

const entries = new Map<string, Entry>();

async function fetchBytes(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The PDF at `url`, open, shared with every other embed of it while
 * `signal` has not aborted. `open` opens the bytes in the engine; `load`
 * fetches them (tests pass their own).
 */
export function sharedPdfDocument(
  url: string,
  signal: AbortSignal,
  { open, load = fetchBytes }: { open: OpenPdf; load?: LoadPdfBytes },
): Promise<OpenedPdf> {
  const held = entries.get(url) ?? createEntry(url, open, load);
  held.users++;
  const release = (): void => {
    held.users--;
    if (held.users === 0) {
      forget(url, held);
      held.controller.abort();
      void held.document.then(
        (document) => document.close().catch(() => undefined),
        () => undefined,
      );
    }
  };
  if (signal.aborted) {
    release();
  } else {
    signal.addEventListener("abort", release, { once: true });
  }
  return held.document;
}

function createEntry(url: string, open: OpenPdf, load: LoadPdfBytes): Entry {
  const controller = new AbortController();
  const created: Entry = {
    // The bytes are this closure's alone: they go once the document is open.
    document: load(url, controller.signal).then(open),
    controller,
    users: 0,
  };
  // A failed fetch or open is not kept: the next embed tries again.
  created.document.catch(() => forget(url, created));
  entries.set(url, created);
  return created;
}

/** How wide an embed draws a page before the page's own scale. */
const EMBED_PAGE_WIDTH = 760;

/**
 * An embed's page turns: each renders its page of the embed's open
 * document (`document`, opened once), only the latest turn is drawn, and
 * nothing is once the embed has gone (`signal`).
 */
export function pdfPagePainter({
  document,
  signal,
  draw,
  fail,
}: {
  document: () => Promise<OpenedPdf>;
  signal: AbortSignal;
  draw: (rendered: RenderedPdfPage) => void;
  fail: (error: unknown) => void;
}): (page: number) => Promise<void> {
  let opening: Promise<OpenedPdf> | undefined;
  let turn = 0;
  return async (page) => {
    const mine = ++turn;
    const isCurrent = (): boolean => !signal.aborted && mine === turn;
    try {
      opening ??= document();
      const opened = await opening;
      if (!isCurrent()) {
        return;
      }
      const rendered = await opened.render(page, EMBED_PAGE_WIDTH);
      if (isCurrent()) {
        draw(rendered);
      }
    } catch (error) {
      if (isCurrent()) {
        fail(error);
      }
    }
  };
}

/** The document's engine failed it: embeds from now on open it again. */
export function forgetPdfDocument(url: string, document: OpenedPdf): void {
  const entry = entries.get(url);
  void entry?.document.then(
    (current) => {
      if (current === document) {
        forget(url, entry);
      }
    },
    () => undefined,
  );
}

/** Files changed: embeds from now on fetch and open theirs again. */
export function forgetPdfDocuments(): void {
  entries.clear();
}

function forget(url: string, entry: Entry): void {
  if (entries.get(url) === entry) {
    entries.delete(url);
  }
}
