/**
 * EmbedPDF's engine (PDFium WASM) for the PDF embeds of the editor: one
 * engine for the page, and the documents embeds open in it
 * (`pdf-documents.ts` shares each among the embeds of one file).
 */
import type { LocalEngine } from "@embedpdf/engine";
import type { OpenedPdf, RenderedPdfPage } from "./pdf-documents";
import { t } from "@workshop/l10n";

type EngineDocument = Awaited<ReturnType<LocalEngine["open"]>>;
type PageLayout = Awaited<
  ReturnType<EngineDocument["pages"]["list"]>
>["pages"][number];

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
): Promise<EngineDocument> {
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

/** Open a PDF for embeds: its pages are listed once, then each turn only renders. */
export async function openPdfInEngine(
  bytes: Uint8Array,
  wasmBinaryOverride?: ArrayBuffer,
): Promise<OpenedPdf> {
  const pdf = await openDocument(bytes, wasmBinaryOverride);
  let pages: readonly PageLayout[];
  try {
    ({ pages } = await pdf.pages.list());
    if (pages.length === 0) {
      throw new Error(t("PDF document has no pages"));
    }
  } catch (error) {
    await pdf.close().catch(() => undefined);
    throw error;
  }
  return {
    pageCount: pages.length,
    render: (page, targetWidth) =>
      renderPage(pdf, { pages, page, targetWidth }),
    close: () => pdf.close(),
  };
}

/** Render a 1-indexed page into an RGBA pixel buffer. */
async function renderPage(
  pdf: EngineDocument,
  {
    pages,
    page: requestedPage,
    targetWidth,
  }: { pages: readonly PageLayout[]; page: number; targetWidth: number },
): Promise<RenderedPdfPage> {
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
}
