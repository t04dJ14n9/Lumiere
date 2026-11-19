import type { LocalEngine } from "@embedpdf/engine";
import { sharedPdfBytes } from "./pdf-bytes";

export interface PdfEmbedParams {
  readonly page: number;
  readonly height?: number;
}

export interface RenderedPdfPage {
  readonly pageCount: number;
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

function resolveHeightParam(
  rawHeight: number,
  fallbackHeight?: number,
): number | undefined {
  if (Number.isFinite(rawHeight) && rawHeight > 0) {
    return rawHeight;
  }
  if (
    fallbackHeight !== undefined &&
    Number.isFinite(fallbackHeight) &&
    fallbackHeight > 0
  ) {
    return Math.round(fallbackHeight);
  }
  return undefined;
}

/**
 * Parse Obsidian PDF embed subpath parameters (`#page=3`, `#height=400`,
 * `#page=3&height=400`) from an embed target string.
 */
export function parsePdfEmbedSubpath(
  target: string,
  fallbackHeight?: number,
): PdfEmbedParams {
  const clean = target.split("|")[0] ?? "";
  const hash = clean.indexOf("#");
  const fragment = hash < 0 ? "" : clean.slice(hash + 1).trim();
  const params = new URLSearchParams(fragment);

  const rawPage = Number.parseInt(params.get("page") ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawHeight = Number.parseInt(params.get("height") ?? "", 10);
  const height = resolveHeightParam(rawHeight, fallbackHeight);

  return height === undefined ? { page } : { page, height };
}

/**
 * Build the target href passed to the host `links.open` handler so clicking
 * the PDF embed's Open button opens `lumiere.pdf.viewer` at `#page=N`.
 */
export function formatPdfOpenTarget(target: string, page: number): string {
  const basePath = (target.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return `${basePath}#page=${safePage}`;
}

/** Extract the display filename for the PDF embed toolbar. */
export function pdfFilename(target: string): string {
  const basePath = (target.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
  const rawName = basePath.split("/").at(-1) || basePath;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

let enginePromise: Promise<LocalEngine> | undefined;

/** The page names the engine's file in `data-pdfium-wasm`, as the PDF viewer's page does. */
function resolveWasmUrl(): string {
  if (typeof document !== "undefined") {
    const configured = document.getElementById("app")?.dataset["pdfiumWasm"];
    if (configured) {
      return configured;
    }
  }
  return "/dist/webview/embedpdf.wasm";
}

/**
 * One engine for every embed of the editor. It runs in this thread because
 * the editor's page allows no workers (webview-html.ts has no `worker-src`);
 * the wasm is fetched here, from the URL the page names, and handed over as
 * bytes.
 */
async function loadEngine(
  wasmBinaryOverride?: ArrayBuffer,
): Promise<LocalEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { createLocalEngine } = await import("@embedpdf/engine");
      const wasmBinary =
        wasmBinaryOverride ??
        (await (await fetch(resolveWasmUrl())).arrayBuffer());
      return createLocalEngine({ runtime: { prefer: "wasm", wasmBinary } });
    })().catch((error: unknown) => {
      enginePromise = undefined;
      throw error;
    });
  }
  return enginePromise;
}

/**
 * Open a PDF in the shared engine. The engine starts PDFium on its first
 * job, so a failure to start shows up here, and leaves an engine that
 * rejects every job from then on: it is dropped, and the next embed starts
 * a new one.
 */
async function openDocument(
  bytes: Uint8Array,
  wasmBinaryOverride?: ArrayBuffer,
) {
  const engine = await loadEngine(wasmBinaryOverride);
  try {
    return await engine.open({ kind: "bytes", bytes });
  } catch (error) {
    const { EngineError, EngineErrorCode } = await import("@embedpdf/engine");
    if (EngineError.is(error, EngineErrorCode.RuntimeUnavailable)) {
      enginePromise = undefined;
      void engine.destroy().catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Render a 1-indexed page from a PDF byte buffer into an RGBA pixel buffer
 * using EmbedPDF's engine (PDFium WASM).
 */
export async function renderPdfPageFromBytes(
  bytes: Uint8Array,
  requestedPage: number,
  targetWidth = 760,
  wasmBinaryOverride?: ArrayBuffer,
): Promise<RenderedPdfPage> {
  const pdf = await openDocument(bytes, wasmBinaryOverride);
  try {
    const { pages } = await pdf.pages.list();
    if (pages.length === 0) {
      throw new Error("PDF document has no pages");
    }
    const page = Math.min(
      Math.max(1, Math.floor(requestedPage || 1)),
      pages.length,
    );
    const layout = pages[page - 1]!;
    // `size` is the page unrotated, and so is its picture unless asked
    // otherwise: the page's own rotation draws it the way a viewer shows it,
    // and a page turned by 90 or 270 degrees is as wide as it was tall.
    const turned = layout.rotation === 90 || layout.rotation === 270;
    const pageWidth = Math.max(
      1,
      turned ? layout.size.height : layout.size.width,
    );
    const scale = Math.max(1, Math.min(2.5, targetWidth / pageWidth));
    const raster = await pdf.page(layout.ref).render.raw({
      viewport: {
        kind: "width",
        width: Math.max(1, Math.round(pageWidth * scale)),
      },
      rotation: layout.rotation,
      includeAnnotations: true,
    });
    return {
      pageCount: pages.length,
      page,
      width: raster.width,
      height: raster.height,
      rgba: new Uint8ClampedArray(raster.data),
    };
  } finally {
    await pdf.close();
  }
}

export interface MountPdfEmbedOptions {
  readonly node: HTMLElement;
  readonly target: string;
  readonly url: string;
  readonly wiki: boolean;
  readonly signal: AbortSignal;
  readonly measure: () => void;
  readonly open: (target: string, wiki: boolean) => void;
}

interface PdfEmbedDom {
  readonly container: HTMLDivElement;
  readonly viewer: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly prevBtn: HTMLButtonElement;
  readonly nextBtn: HTMLButtonElement;
  readonly pageNumbers: HTMLSpanElement;
  readonly openBtn: HTMLButtonElement;
}

function createNavButton(
  className: string,
  text: string,
  ariaLabel: string,
  disabled: boolean,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `pdf-nav-button ${className}`;
  btn.textContent = text;
  btn.setAttribute("aria-label", ariaLabel);
  btn.disabled = disabled;
  return btn;
}

function buildPdfEmbedDom(
  target: string,
  initialPage: number,
  height: number | undefined,
): PdfEmbedDom {
  const container = document.createElement("div");
  container.className = "pdf-embed";
  container.dataset["page"] = String(initialPage);
  if (height !== undefined) {
    container.style.height = `${height}px`;
    container.dataset["pdfHeight"] = String(height);
  }

  const toolbar = document.createElement("div");
  toolbar.className = "pdf-toolbar";
  const left = document.createElement("div");
  left.className = "pdf-toolbar-left";

  const title = document.createElement("span");
  title.className = "pdf-embed-title";
  title.textContent = pdfFilename(target);

  const prevBtn = createNavButton(
    "pdf-prev-page",
    "‹",
    "Previous page",
    initialPage <= 1,
  );
  const pageNumbers = document.createElement("span");
  pageNumbers.className = "pdf-page-numbers";
  pageNumbers.setAttribute("aria-live", "polite");
  pageNumbers.textContent = `Page ${initialPage}`;
  const nextBtn = createNavButton("pdf-next-page", "›", "Next page", true);
  left.append(title, prevBtn, pageNumbers, nextBtn);

  const right = document.createElement("div");
  right.className = "pdf-toolbar-right";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "open-embed pdf-open-button";
  openBtn.textContent = "Open PDF ↗";
  right.append(openBtn);
  toolbar.append(left, right);

  const viewer = document.createElement("div");
  viewer.className = "pdf-viewer-container";
  const pageWrapper = document.createElement("div");
  pageWrapper.className = "pdf-page-wrapper";
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";
  pageWrapper.append(canvas);
  viewer.append(pageWrapper);
  container.append(toolbar, viewer);

  return { container, viewer, canvas, prevBtn, nextBtn, pageNumbers, openBtn };
}

function drawRenderedPdfPage(
  dom: PdfEmbedDom,
  rendered: RenderedPdfPage,
  target: string,
): void {
  dom.container.dataset["page"] = String(rendered.page);
  dom.container.dataset["pageCount"] = String(rendered.pageCount);
  dom.canvas.dataset["pageNumber"] = String(rendered.page);
  dom.canvas.width = rendered.width;
  dom.canvas.height = rendered.height;
  const ctx2d = dom.canvas.getContext("2d");
  if (ctx2d) {
    const imageData = new ImageData(
      new Uint8ClampedArray(rendered.rgba),
      rendered.width,
      rendered.height,
    );
    ctx2d.putImageData(imageData, 0, 0);
  }
  dom.pageNumbers.textContent = `Page ${rendered.page} / ${rendered.pageCount}`;
  dom.prevBtn.disabled = rendered.page <= 1;
  dom.nextBtn.disabled = rendered.page >= rendered.pageCount;
  dom.openBtn.setAttribute(
    "aria-label",
    `Open ${formatPdfOpenTarget(target, rendered.page)}`,
  );
}

function bindPdfToolbarEvents(
  dom: PdfEmbedDom,
  options: MountPdfEmbedOptions,
  getState: () => { currentPage: number; totalPages: number },
  paintPage: (page: number) => Promise<void>,
): void {
  const { target, wiki, signal, open } = options;
  dom.openBtn.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(formatPdfOpenTarget(target, getState().currentPage), wiki);
    },
    { signal },
  );
  dom.prevBtn.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { currentPage } = getState();
      if (currentPage > 1) {
        void paintPage(currentPage - 1);
      }
    },
    { signal },
  );
  dom.nextBtn.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { currentPage, totalPages } = getState();
      if (currentPage < totalPages) {
        void paintPage(currentPage + 1);
      }
    },
    { signal },
  );
}

/**
 * Mount an Obsidian-compatible inline `.pdf-embed` viewer inside `node`
 * powered by EmbedPDF's engine (`@embedpdf/engine`).
 */
export function mountPdfEmbed(options: MountPdfEmbedOptions): void {
  const { node, target, url, signal, measure } = options;
  const attrHeight = node.dataset["height"]
    ? Number(node.dataset["height"])
    : undefined;
  const parsed = parsePdfEmbedSubpath(target, attrHeight);

  let currentPage = parsed.page;
  let totalPages = Math.max(1, currentPage);
  let pdfBytes: Uint8Array | undefined;
  let renderSeq = 0;

  const dom = buildPdfEmbedDom(target, currentPage, parsed.height);
  dom.openBtn.setAttribute(
    "aria-label",
    `Open ${formatPdfOpenTarget(target, currentPage)}`,
  );
  node.replaceChildren(dom.container);

  const paintPage = async (pageToRender: number): Promise<void> => {
    const seq = ++renderSeq;
    try {
      pdfBytes ??= await sharedPdfBytes(url, signal);
      if (signal.aborted || seq !== renderSeq) {
        return;
      }
      const rendered = await renderPdfPageFromBytes(pdfBytes, pageToRender);
      if (signal.aborted || seq !== renderSeq) {
        return;
      }
      currentPage = rendered.page;
      totalPages = rendered.pageCount;
      drawRenderedPdfPage(dom, rendered, target);
      measure();
    } catch (error) {
      if (signal.aborted || seq !== renderSeq) {
        return;
      }
      dom.container.classList.add("pdf-embed-error");
      dom.pageNumbers.textContent = `Page ${currentPage}`;
      dom.viewer.textContent = `Could not render ${pdfFilename(target)}: ${String(error)}`;
      measure();
    }
  };

  bindPdfToolbarEvents(
    dom,
    options,
    () => ({ currentPage, totalPages }),
    paintPage,
  );
  void paintPage(currentPage);
}
