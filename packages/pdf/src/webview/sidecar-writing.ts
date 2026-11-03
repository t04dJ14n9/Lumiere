import { useRegistry } from "@embedpdf/core/react";
import type { PdfDocumentObject, PdfEngine, Rect } from "@embedpdf/models";
import type { AnnotationTool } from "@embedpdf/plugin-annotation";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useEffect } from "react";
import {
  CONTEXT_LENGTH,
  MAX_QUOTE_LENGTH,
  newHighlightId,
  type SidecarHighlight,
} from "../shared/sidecar-format";
import { highlightStyleOf } from "../shared/highlight-style";
import { currentPageColors } from "./page-colors";
import { annotationLoadState } from "./annotation-load-state";
import { postToHost } from "./host";
import { DOCUMENT_ID } from "./plugins";
import {
  setSidecarWriter,
  type FormattedSelection,
} from "./sidecar-highlight-tool";
import { selectSidecarHighlight, showSidecarHighlight } from "./sidecar-store";

/**
 * Write highlights to the sidecar while the viewer shows `pdf`. The quote and
 * the text around it are read from the PDF, for the sidecar to find the
 * highlight again if the PDF's layout changes.
 */
export function useSidecarHighlightWriting(pdf: PdfDocumentObject): void {
  const { registry } = useRegistry();
  const { provides: selection } = useSelectionCapability();
  useEffect(() => {
    const engine = registry?.getEngine();
    if (!engine || !selection) {
      return;
    }
    setSidecarWriter((selections, tool) => {
      // Read now: EmbedPDF clears the selection as soon as the tool returns.
      const { slices } = selection.forDocument(DOCUMENT_ID).getState();
      const style = highlightStyle(tool);
      for (const item of selections) {
        const slice = slices[item.pageIndex] ?? { start: 0, count: 0 };
        void readQuote(engine, pdf, item.pageIndex, slice).then((text) =>
          publish(newHighlight(item, style, text)),
        );
      }
    });
    return () => setSidecarWriter(undefined);
  }, [registry, selection, pdf]);
}

function publish(highlight: SidecarHighlight): void {
  showSidecarHighlight(highlight);
  selectSidecarHighlight(highlight.id);
  postToHost({
    type: "sidecarWrite",
    load: annotationLoadState()?.load ?? 0,
    op: "upsert",
    highlight,
  });
}

function newHighlight(
  item: FormattedSelection,
  style: { color: string; opacity: number },
  text: { quote: string; contextBefore: string; contextAfter: string },
): SidecarHighlight {
  const now = new Date().toISOString();
  return {
    id: newHighlightId(randomHex),
    page: item.pageIndex + 1,
    subtype: "highlight",
    ...style,
    segmentRects: item.segmentRects.map(segmentRect),
    ...text,
    created: now,
    modified: now,
  };
}

/** The selected text of one page, and the text just before and after it. */
async function readQuote(
  engine: PdfEngine,
  pdf: PdfDocumentObject,
  pageIndex: number,
  { start, count }: { start: number; count: number },
): Promise<{ quote: string; contextBefore: string; contextAfter: string }> {
  const before = Math.max(0, start - CONTEXT_LENGTH);
  const slice = (charIndex: number, charCount: number) =>
    charCount > 0
      ? engine
          .getTextSlices(pdf, [{ pageIndex, charIndex, charCount }])
          .toPromise()
          .then((texts) => texts[0] ?? "")
          .catch(() => "")
      : Promise.resolve("");
  const [contextBefore, quote, contextAfter] = await Promise.all([
    slice(before, start - before),
    slice(start, count),
    // Past the end of the page, PDFium reads what there is (or nothing).
    slice(start + count, CONTEXT_LENGTH),
  ]);
  return {
    quote: quote.slice(0, MAX_QUOTE_LENGTH),
    contextBefore,
    contextAfter,
  };
}

/** The tool's colour and opacity, as the status bar's colour picker set them. */
function highlightStyle(tool: AnnotationTool): {
  color: string;
  opacity: number;
} {
  return highlightStyleOf(
    tool.defaults as {
      strokeColor?: unknown;
      color?: unknown;
      opacity?: unknown;
    },
    currentPageColors(),
  );
}

function segmentRect({
  origin,
  size,
}: Rect): SidecarHighlight["segmentRects"][number] {
  return { x: origin.x, y: origin.y, w: size.width, h: size.height };
}

function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
