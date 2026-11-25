import {
  forgetPdfDocument,
  pdfPagePainter,
  sharedPdfDocument,
  type OpenedPdf,
  type RenderedPdfPage,
} from "./pdf-documents";
import { openPdfInEngine } from "./pdf-engine";
import { t } from "@workshop/l10n";

export interface PdfEmbedParams {
  readonly page: number;
  readonly height?: number;
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
    t("Previous page"),
    initialPage <= 1,
  );
  const pageNumbers = document.createElement("span");
  pageNumbers.className = "pdf-page-numbers";
  pageNumbers.setAttribute("aria-live", "polite");
  pageNumbers.textContent = t("Page {0}", initialPage);
  const nextBtn = createNavButton("pdf-next-page", "›", t("Next page"), true);
  left.append(title, prevBtn, pageNumbers, nextBtn);

  const right = document.createElement("div");
  right.className = "pdf-toolbar-right";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "open-embed pdf-open-button";
  openBtn.textContent = t("Open PDF ↗");
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
  dom.pageNumbers.textContent = t(
    "Page {0} / {1}",
    rendered.page,
    rendered.pageCount,
  );
  dom.prevBtn.disabled = rendered.page <= 1;
  dom.nextBtn.disabled = rendered.page >= rendered.pageCount;
  dom.openBtn.setAttribute(
    "aria-label",
    t("Open {0}", formatPdfOpenTarget(target, rendered.page)),
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
  let opened: Promise<OpenedPdf> | undefined;

  const dom = buildPdfEmbedDom(target, currentPage, parsed.height);
  dom.openBtn.setAttribute(
    "aria-label",
    t("Open {0}", formatPdfOpenTarget(target, currentPage)),
  );
  node.replaceChildren(dom.container);

  // Opened once for the embed, and shared with the other embeds of the file:
  // a page turn only renders the page.
  const paintPage = pdfPagePainter({
    document: () =>
      (opened = sharedPdfDocument(url, signal, { open: openPdfInEngine })),
    signal,
    draw: (rendered) => {
      currentPage = rendered.page;
      totalPages = rendered.pageCount;
      drawRenderedPdfPage(dom, rendered, target);
      measure();
    },
    fail: (error) => {
      // An engine that failed the document: the next embed opens it again.
      void opened?.then(
        (document) => forgetPdfDocument(url, document),
        () => undefined,
      );
      dom.container.classList.add("pdf-embed-error");
      dom.pageNumbers.textContent = t("Page {0}", currentPage);
      dom.viewer.textContent = t(
        "Could not render {0}: {1}",
        pdfFilename(target),
        String(error),
      );
      measure();
    },
  });

  bindPdfToolbarEvents(
    dom,
    options,
    () => ({ currentPage, totalPages }),
    paintPage,
  );
  void paintPage(currentPage);
}
