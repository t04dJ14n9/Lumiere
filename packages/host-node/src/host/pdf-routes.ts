/**
 * The PDF viewer's routes (pdf-pages.ts), under the editor routes' base: a
 * PDF's page, the built viewer, and the bytes of the PDF a page is loading.
 * Authentication is the caller's, as for the editor's pages.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { injectShim, socketSource } from "./page";
import { pdfQuery } from "./page-query";
import { PdfPages, type PdfPage } from "./pdf-pages";
import { isInsideRegisteredRoot, resolveContainedNote } from "./paths";
import { byteRange, serveStatic } from "./static";

export interface PdfRouteOptions {
  /** The editor routes' base path (`/lumiere`). */
  readonly base: string;
  /** The built viewer (`packages/pdf/dist/webview`). */
  readonly viewer: string;
  /** The workspaces the embedder registered (`LumiereHost.workspaceRoots`). */
  readonly roots: () => readonly string[];
  readonly log: (message: string) => void;
}

export interface PdfRoutes {
  /** Answer `rest` (the path after the base); false when it is not a PDF route. */
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    rest: string,
  ): Promise<boolean>;
  /** The open PDF page with this id, for its socket. */
  page(id: string): PdfPage | undefined;
  close(): void;
}

/** An embedder that ships no PDF viewer: PDFs do not open. */
export const NO_PDF_ROUTES: PdfRoutes = {
  handle: async () => false,
  page: () => undefined,
  close: () => {},
};

export function createPdfRoutes(options: PdfRouteOptions): PdfRoutes {
  const pages = new PdfPages();
  return {
    async handle(req, res, rest) {
      const url = new URL(req.url ?? "/", "http://host");
      if (rest === "/pdf") {
        await servePdfPage({ req, res, url, pages, options });
      } else if (rest.startsWith("/pdf/viewer/")) {
        await serveStatic(
          res,
          options.viewer,
          rest.slice("/pdf/viewer/".length),
          req.headers,
        );
      } else if (rest === "/pdf/bytes") {
        await serveBytes(res, { url, range: req.headers.range }, pages);
      } else {
        return false;
      }
      return true;
    },
    page: (id) => pages.get(id),
    close: () => pages.dispose(),
  };
}

interface PdfPageRequest {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly pages: PdfPages;
  readonly options: PdfRouteOptions;
}

async function servePdfPage({
  req,
  res,
  url,
  pages,
  options,
}: PdfPageRequest): Promise<void> {
  const query = pdfQuery(url);
  if (!query) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Not a PDF");
    return;
  }
  // Both canonical, and the PDF inside the workspace even through symlinks.
  const resolved = await resolveContainedNote(query.note, query.root);
  if (!resolved) {
    res.writeHead(403).end();
    return;
  }
  // As for a note's page: the query names a workspace, the embedder decides
  // which folders are one.
  const root = pathToFileURL(resolved.root).toString();
  if (!isInsideRegisteredRoot(options.roots(), root)) {
    res.writeHead(403).end();
    return;
  }
  const { base } = options;
  const page = pages.open({
    uri: pathToFileURL(resolved.note).toString(),
    root,
    cspSource: socketSource(req.headers.host ?? ""),
    // The editor ships the same PDF engine (both pin one
    // @embedpdf/engine-runtime-wasm32).
    asset: (name) =>
      name === "embedpdf.wasm"
        ? `${base}/m/webview/embedpdf.wasm`
        : `${base}/pdf/viewer/${name}`,
    bytesUrl: (id, load) =>
      `${base}/pdf/bytes?page=${encodeURIComponent(id)}&load=${load}`,
    log: options.log,
  });
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(injectShim(page.html, page.id, `${base}/page/shim.js`));
}

/**
 * The bytes of the load a page asked for, while it is that page's newest:
 * all of them, or the one range a request asks for, from the bytes the
 * viewer core read (never read again from disk, which may have changed).
 */
async function serveBytes(
  res: ServerResponse,
  { url, range }: { url: URL; range: string | undefined },
  pages: PdfPages,
): Promise<void> {
  const page = pages.get(url.searchParams.get("page") ?? "");
  const bytes = page?.bytesOf(Number(url.searchParams.get("load")));
  if (!page || !bytes) {
    res.writeHead(404).end();
    return;
  }
  // The bytes were read inside the root. Once the PDF no longer resolves
  // inside it (moved or relinked), stop serving them.
  if (!(await page.contained())) {
    res.writeHead(403).end();
    return;
  }
  sendBytes(res, Buffer.from(bytes), range);
}

/** A buffer as a whole PDF, or the one byte range a request asks for. */
function sendBytes(
  res: ServerResponse,
  data: Buffer,
  rangeHeader: string | undefined,
): void {
  const headers = {
    "content-type": "application/pdf",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  const range = byteRange(rangeHeader ?? "", data.length);
  if (range === "unsatisfiable") {
    res
      .writeHead(416, { ...headers, "content-range": `bytes */${data.length}` })
      .end();
    return;
  }
  if (!range) {
    res.writeHead(200, headers).end(data);
    return;
  }
  res
    .writeHead(206, {
      ...headers,
      "content-range": `bytes ${range.start}-${range.end}/${data.length}`,
    })
    // A view of the same memory, not a copy.
    .end(data.subarray(range.start, range.end + 1));
}
