/**
 * LEGACY / UNHOOKED — Unhooked viewer reattach. Shared geometry helpers live in src/shared/sidecar-reattach.ts (still used by backlink resolve).
 * See packages/pdf/docs/sidecar-highlights.md.
 */
import { useRegistry } from "@embedpdf/core/react";
import type {
  PdfDocumentObject,
  PdfEngine,
  PdfGlyphObject,
} from "@embedpdf/models";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SidecarHighlight } from "../shared/sidecar-format";
import {
  coversGlyphs,
  findQuote,
  lineRects,
  type GlyphBox,
} from "../shared/sidecar-reattach";
import { annotationLoadState } from "./annotation-load-state";
import { postToHost } from "./host";
import {
  markSidecarStale,
  onSidecarChange,
  showSidecarHighlight,
  sidecarState,
} from "./sidecar-store";

/**
 * Re-attach sidecar highlights when the PDF changed under them (design:
 * "Re-attach"). Each highlight is checked once per version of it: if its
 * boxes no longer cover its quote, the quote is looked for on its page; a
 * unique match moves the highlight and rewrites its sidecar block, no match
 * leaves it where it was, drawn as stale. Highlights without a quote
 * (written by hand) are left alone.
 */
export function useSidecarReattach(pdf: PdfDocumentObject): void {
  const { registry } = useRegistry();
  const { highlights } = useSyncExternalStore(onSidecarChange, sidecarState);
  const checked = useRef(new Set<string>());
  useEffect(() => {
    const engine = registry?.getEngine();
    if (!engine || !highlights) {
      return;
    }
    const due = highlights.filter(
      (highlight) =>
        highlight.quote.trim() && !checked.current.has(versionOf(highlight)),
    );
    due.forEach((highlight) => checked.current.add(versionOf(highlight)));
    let live = true;
    void reattach(engine, pdf, due, (moved) => {
      if (live) {
        checked.current.add(versionOf(moved));
      }
      return live;
    });
    return () => {
      live = false;
    };
  }, [registry, pdf, highlights]);
}

function versionOf(highlight: SidecarHighlight): string {
  return `${highlight.id}@${highlight.modified}`;
}

/** Check the highlights page by page; `keep` says whether to still apply a move. */
async function reattach(
  engine: PdfEngine,
  pdf: PdfDocumentObject,
  highlights: readonly SidecarHighlight[],
  keep: (moved: SidecarHighlight) => boolean,
): Promise<void> {
  const pages = new Set(highlights.map((highlight) => highlight.page));
  for (const number of pages) {
    const page = pdf.pages[number - 1];
    const text = page ? await readPage(engine, pdf, page) : undefined;
    for (const highlight of highlights.filter((h) => h.page === number)) {
      const result = text && placeAgain(highlight, text);
      if (!result) {
        markSidecarStale(highlight.id);
      } else if (result !== highlight && keep(result)) {
        showSidecarHighlight(result);
        postToHost({
          type: "sidecarWrite",
          load: annotationLoadState()?.load ?? 0,
          op: "upsert",
          highlight: result,
        });
      }
    }
  }
}

/** The highlight as it is (in place), moved, or undefined when its quote is gone. */
function placeAgain(
  highlight: SidecarHighlight,
  page: { text: string; boxes: (GlyphBox | undefined)[] },
): SidecarHighlight | undefined {
  const match = findQuote(page.text, highlight);
  if (!match) {
    return undefined;
  }
  const boxes = page.boxes
    .slice(match.start, match.end)
    .filter((box): box is GlyphBox => box !== undefined);
  if (boxes.length === 0) {
    return undefined;
  }
  if (coversGlyphs(highlight.segmentRects, boxes)) {
    return highlight;
  }
  return {
    ...highlight,
    segmentRects: lineRects(boxes),
    modified: new Date().toISOString(),
  };
}

/** A page's text and the box of each of its characters (none for spaces). */
async function readPage(
  engine: PdfEngine,
  pdf: PdfDocumentObject,
  page: PdfDocumentObject["pages"][number],
): Promise<{ text: string; boxes: (GlyphBox | undefined)[] } | undefined> {
  try {
    const glyphs = await engine.getPageGlyphs(pdf, page).toPromise();
    const [text] = await engine
      .getTextSlices(pdf, [
        { pageIndex: page.index, charIndex: 0, charCount: glyphs.length },
      ])
      .toPromise();
    return { text: text ?? "", boxes: Array.from(glyphs, glyphBox) };
  } catch {
    return undefined;
  }
}

function glyphBox(glyph: PdfGlyphObject | undefined): GlyphBox | undefined {
  if (!glyph || glyph.isSpace) {
    return undefined;
  }
  const { x, y } = glyph.origin;
  const { width, height } = glyph.size;
  return width > 0 && height > 0 ? [x, y, x + width, y + height] : undefined;
}
