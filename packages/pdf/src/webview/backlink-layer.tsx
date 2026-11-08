import { useRegistry } from "@embedpdf/core/react";
import type {
  PdfDocumentObject,
  PdfEngine,
  PdfGlyphObject,
} from "@embedpdf/models";
import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PdfBacklinkHit } from "../shared/pdf-backlink-index";
import { alignGlyphText } from "../shared/page-glyph-text";
import { resolveTextToLineRects } from "../shared/pdf-backlink-resolve";
import { type GlyphBox } from "../shared/line-rects";
import { BacklinkOverlay, type ResolvedOverlay } from "./backlink-overlay";
import { backlinkState, onBacklinkChange } from "./backlink-store";

/**
 * Vault backlink overlays on one page: resolve `#:~:text=` to glyph line
 * boxes, paint above hard-written annotations, hover shows the note path,
 * click opens that note at the link. Overlays never enter mark selection,
 * and in Annotate mode they let pointer events through to the annotations.
 */
export function BacklinkLayer({
  pdf,
  pageIndex,
  scale,
  annotate,
}: {
  pdf: PdfDocumentObject;
  pageIndex: number;
  scale: number;
  /** The Annotate tool is active. */
  annotate: boolean;
}): React.JSX.Element | null {
  const { hits } = useSyncExternalStore(onBacklinkChange, backlinkState);
  const { registry } = useRegistry();
  const [overlays, setOverlays] = useState<ResolvedOverlay[]>([]);
  const page = pageIndex + 1;
  const pageHits = useMemo(
    () =>
      hits.filter((hit) => hit.page === page && hit.textFragment?.textStart),
    [hits, page],
  );

  useEffect(() => {
    const engine = registry?.getEngine();
    if (!engine || pageHits.length === 0) {
      setOverlays([]);
      return;
    }
    let live = true;
    void resolvePage(engine, pdf, pageIndex, pageHits).then((next) => {
      if (live) {
        setOverlays(next);
      }
    });
    return () => {
      live = false;
    };
  }, [registry, pdf, pageIndex, pageHits]);

  if (overlays.length === 0) {
    return null;
  }
  return (
    <>
      {overlays.map((overlay) => (
        <BacklinkOverlay
          key={overlay.key}
          overlay={overlay}
          scale={scale}
          isPassive={annotate}
        />
      ))}
    </>
  );
}

async function resolvePage(
  engine: PdfEngine,
  pdf: PdfDocumentObject,
  pageIndex: number,
  hits: readonly PdfBacklinkHit[],
): Promise<ResolvedOverlay[]> {
  const page = pdf.pages[pageIndex];
  if (!page) {
    return [];
  }
  const text = await readPage(engine, pdf, page);
  if (!text) {
    return [];
  }
  const overlays: ResolvedOverlay[] = [];
  for (const hit of hits) {
    if (!hit.textFragment) {
      continue;
    }
    const rects = resolveTextToLineRects(
      text.text,
      text.boxes,
      hit.textFragment,
    );
    if (!rects) {
      continue;
    }
    overlays.push({
      key: `${hit.noteUri}#${hit.linkOffset}`,
      hit,
      rects,
    });
  }
  return overlays;
}

/** A page's text and the box of each of its UTF-16 units (none for spaces). */
async function readPage(
  engine: PdfEngine,
  pdf: PdfDocumentObject,
  page: PdfDocumentObject["pages"][number],
): Promise<{ text: string; boxes: (GlyphBox | undefined)[] } | undefined> {
  try {
    const glyphs = await engine.getPageGlyphs(pdf, page).toPromise();
    const boxes = Array.from(glyphs, glyphBox);
    const [text = ""] = await engine
      .getTextSlices(pdf, [
        { pageIndex: page.index, charIndex: 0, charCount: glyphs.length },
      ])
      .toPromise();
    if (text.length === glyphs.length) {
      return { text, boxes };
    }
    // EmbedPDF drops markers from the text (a hyphen at a line end), so its
    // characters no longer line up with the glyphs: read them one by one.
    const perGlyph = await engine
      .getTextSlices(
        pdf,
        Array.from({ length: glyphs.length }, (_, charIndex) => ({
          pageIndex: page.index,
          charIndex,
          charCount: 1,
        })),
      )
      .toPromise();
    return alignGlyphText(perGlyph, boxes);
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
