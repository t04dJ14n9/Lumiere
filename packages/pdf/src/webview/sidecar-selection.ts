/**
 * LEGACY / UNHOOKED — Unhooked: Annotate hit-test / Del for sidecar overlays removed with the paint layer.
 * See packages/pdf/docs/sidecar-highlights.md.
 */
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import type { PdfDocumentObject } from "@embedpdf/models";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { findEmbeddedSelectHit } from "../shared/embedded-hit";
import type { SidecarHighlight } from "../shared/sidecar-format";
import { regionOf } from "../shared/sidecar-region";
import { annotationLoadState } from "./annotation-load-state";
import type { SetAnnotationRegion } from "./annotation-selection";
import { postToHost } from "./host";
import { DOCUMENT_ID } from "./plugins";
import {
  hideSidecarHighlight,
  onSidecarChange,
  selectedSidecarHighlight,
  selectSidecarHighlight,
  sidecarState,
} from "./sidecar-store";

/**
 * How far outside a highlight's lines a click still selects it, in points.
 * User repro: tiny viewrect Copy-link (not `#hl-`) meant the click missed the
 * mark and became text/region selection; Delete then no-oped. A few points of
 * slop plus a bounds fallback covers gaps between multi-line segments.
 */
const HIT_SLOP = 4;
/** Looser hit against the union box of all segment lines (between-line clicks). */
const BOUNDS_SLOP = 2;

/**
 * Annotate mode on sidecar highlights, as on the PDF's own marks: a click
 * selects one (the selection reports it with its `#hl-` id, so Copy link to
 * this links to it), and Delete removes it from the sidecar. Selecting one
 * deselects EmbedPDF's marks, and the other way round.
 */
export function useSidecarSelection(
  pdf: PdfDocumentObject,
  annotate: boolean,
  setAnnotationRegion: SetAnnotationRegion,
): { hasSelection: boolean; deleteSelected: () => void } {
  const { selectedId } = useSyncExternalStore(onSidecarChange, sidecarState);
  useSelectOnClick(pdf, annotate);
  useReportSelected(selectedId, setAnnotationRegion);
  const deleteSelected = useCallback((): void => {
    const selected = selectedSidecarHighlight();
    if (!selected) {
      return;
    }
    hideSidecarHighlight(selected.id);
    postToHost({
      type: "sidecarWrite",
      load: annotationLoadState()?.load ?? 0,
      op: "delete",
      id: selected.id,
    });
  }, []);
  return { hasSelection: annotate && selectedId !== undefined, deleteSelected };
}

function useSelectOnClick(pdf: PdfDocumentObject, annotate: boolean): void {
  const { provides: annots } = useAnnotationCapability();
  useEffect(() => {
    if (!annotate) {
      selectSidecarHighlight(undefined);
      return;
    }
    const scope = annots?.forDocument(DOCUMENT_ID);
    const onPointerDown = (event: PointerEvent): void => {
      const pageHit = pagePointAt(pdf, event.clientX, event.clientY);
      if (!pageHit) {
        selectSidecarHighlight(undefined);
        return;
      }
      const sidecar = sidecarAt(pageHit);
      if (sidecar) {
        // Stop text-selection / new-mark tools from stealing the click.
        event.preventDefault();
        event.stopImmediatePropagation();
        scope?.deselectAnnotation();
        selectSidecarHighlight(sidecar.id);
        return;
      }
      const embedded = embeddedAt(scope, pageHit);
      if (embedded) {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectSidecarHighlight(undefined);
        scope?.selectAnnotation(embedded.pageIndex, embedded.id);
        return;
      }
      selectSidecarHighlight(undefined);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    const stopFollowing = scope?.onStateChange(() => {
      if (scope.getSelectedAnnotations().length > 0) {
        selectSidecarHighlight(undefined);
      }
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      stopFollowing?.();
    };
  }, [annots, pdf, annotate]);
}

/** Report the selected highlight as the viewer's selection, as EmbedPDF's marks are. */
function useReportSelected(
  selectedId: string | undefined,
  setAnnotationRegion: SetAnnotationRegion,
): void {
  const owned = useRef(false);
  const report = useRef(setAnnotationRegion);
  report.current = setAnnotationRegion;
  useEffect(() => {
    const selected = selectedSidecarHighlight();
    if (selected) {
      owned.current = true;
      report.current(regionOf(selected));
    } else if (owned.current) {
      owned.current = false;
      report.current(undefined);
    }
  }, [selectedId]);
}

type PageHit = { pageIndex: number; px: number; py: number };

function pagePointAt(
  pdf: PdfDocumentObject,
  x: number,
  y: number,
): PageHit | undefined {
  const element = document
    .elementsFromPoint(x, y)
    .find((candidate) => candidate.hasAttribute("data-page-index"));
  const index = Number(element?.getAttribute("data-page-index"));
  const page = pdf.pages[index];
  // Pages stored sideways (/Rotate) are turned inside their box: not hit-tested.
  if (!element || !page || page.rotation) {
    return undefined;
  }
  const box = element.getBoundingClientRect();
  const scale = box.width / Math.max(1, page.size.width);
  return {
    pageIndex: index,
    px: (x - box.left) / scale,
    py: (y - box.top) / scale,
  };
}

/** The sidecar highlight under a page point, if any. */
function sidecarAt({
  pageIndex,
  px,
  py,
}: PageHit): SidecarHighlight | undefined {
  const highlights = sidecarState().highlights ?? [];
  // The newest on top, as drawn.
  return [...highlights]
    .reverse()
    .find(
      (highlight) =>
        highlight.page === pageIndex + 1 &&
        rectsHit(highlight.segmentRects, px, py),
    );
}

type EmbeddedHit = { pageIndex: number; id: string };

/** Prefer selecting an existing EmbedPDF mark over starting text selection. */
function embeddedAt(
  scope:
    | {
        getAnnotations: (options: { pageIndex: number }) => Array<{
          object: {
            id: string;
            pageIndex: number;
            type?: unknown;
            rect?: {
              origin: { x: number; y: number };
              size: { width: number; height: number };
            };
            segmentRects?: Array<{
              origin: { x: number; y: number };
              size: { width: number; height: number };
            }>;
          };
        }>;
      }
    | undefined,
  hit: PageHit,
): EmbeddedHit | undefined {
  if (!scope) {
    return undefined;
  }
  return findEmbeddedSelectHit(
    scope.getAnnotations({ pageIndex: hit.pageIndex }),
    hit,
  );
}

function rectsHit(
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  px: number,
  py: number,
): boolean {
  if (
    rects.some(
      (r) =>
        px >= r.x - HIT_SLOP &&
        px <= r.x + r.w + HIT_SLOP &&
        py >= r.y - HIT_SLOP &&
        py <= r.y + r.h + HIT_SLOP,
    )
  ) {
    return true;
  }
  if (rects.length === 0) {
    return false;
  }
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return (
    px >= left - BOUNDS_SLOP &&
    px <= right + BOUNDS_SLOP &&
    py >= top - BOUNDS_SLOP &&
    py <= bottom + BOUNDS_SLOP
  );
}
