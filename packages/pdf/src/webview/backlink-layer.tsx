import { usePage, type PageRef } from "@embedpdf/react/runtime";
import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PdfBacklinkHit } from "../shared/pdf-backlink-index";
import { backlinkRects } from "./backlink-rects";
import { BacklinkOverlay, type ResolvedOverlay } from "./backlink-overlay";
import { backlinkState, onBacklinkChange } from "./backlink-store";
import { useTextAccess, type TextAccess } from "./text-access";

/**
 * Vault backlink overlays on one page: resolve `#:~:text=` to the page's
 * line boxes, paint above hard-written annotations, hover shows the note
 * path, click opens that note at the link. Overlays never enter mark
 * selection, and in Annotate mode they let pointer events through to the
 * annotations.
 */
export function BacklinkLayer({
  annotate,
}: {
  /** The Annotate tool is active. */
  annotate: boolean;
}): React.JSX.Element | null {
  const page = usePage();
  const text = useTextAccess();
  const { hits } = useSyncExternalStore(onBacklinkChange, backlinkState);
  const [overlays, setOverlays] = useState<ResolvedOverlay[]>([]);
  const pageNumber = page.pageIndex + 1;
  const pageHits = useMemo(
    () =>
      hits.filter(
        (hit) => hit.page === pageNumber && hit.textFragment?.textStart,
      ),
    [hits, pageNumber],
  );

  useEffect(() => {
    if (!text || pageHits.length === 0) {
      setOverlays([]);
      return;
    }
    let live = true;
    void resolvePage(text, page.ref, pageHits).then((next) => {
      if (live) {
        setOverlays(next);
      }
    });
    return () => {
      live = false;
    };
  }, [text, page.ref, pageHits]);

  if (overlays.length === 0) {
    return null;
  }
  return (
    <>
      {overlays.map((overlay) => (
        <BacklinkOverlay
          key={overlay.key}
          overlay={overlay}
          scale={page.transform.viewScale}
          isPassive={annotate}
        />
      ))}
    </>
  );
}

/** The overlays of a page's hits; none where its text cannot be read. */
async function resolvePage(
  text: TextAccess,
  page: PageRef,
  hits: readonly PdfBacklinkHit[],
): Promise<ResolvedOverlay[]> {
  try {
    const [snapshot, layout] = await Promise.all([
      text.textOf(page),
      text.layoutOf(page),
    ]);
    return hits.flatMap((hit) => {
      const rects = hit.textFragment
        ? backlinkRects(snapshot, layout, hit.textFragment)
        : undefined;
      return rects
        ? [{ key: `${hit.noteUri}#${hit.linkOffset}`, hit, rects }]
        : [];
    });
  } catch {
    // Copy or select forbidden by the PDF, or the page gone: nothing to paint.
    return [];
  }
}
