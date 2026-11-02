import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import type { PdfDocumentObject } from "@embedpdf/models";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PageRect } from "../shared/geometry";
import type { SidecarHighlight } from "../shared/sidecar-format";
import type { RegionSelection } from "../shared/selection";
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

/** How far outside a highlight's lines a click still selects it, in points. */
const HIT_SLOP = 1;

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
      const hit = highlightAt(pdf, event.clientX, event.clientY);
      if (!hit) {
        selectSidecarHighlight(undefined);
        return;
      }
      // EmbedPDF's page listeners would start a new mark here instead.
      event.stopPropagation();
      scope?.deselectAnnotation();
      selectSidecarHighlight(hit.id);
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

/** The selection a highlight stands for: its box, its quote and its id. */
export function regionOf(highlight: SidecarHighlight): RegionSelection {
  const rect: PageRect = [
    Math.min(...highlight.segmentRects.map((r) => r.x)),
    Math.min(...highlight.segmentRects.map((r) => r.y)),
    Math.max(...highlight.segmentRects.map((r) => r.x + r.w)),
    Math.max(...highlight.segmentRects.map((r) => r.y + r.h)),
  ];
  const text = highlight.quote.trim();
  return {
    kind: "region",
    page: highlight.page,
    rect,
    ...(text ? { text } : {}),
    highlightId: highlight.id,
  };
}

/** The sidecar highlight drawn under a window point, if any. */
function highlightAt(
  pdf: PdfDocumentObject,
  x: number,
  y: number,
): SidecarHighlight | undefined {
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
  const px = (x - box.left) / scale;
  const py = (y - box.top) / scale;
  const highlights = sidecarState().highlights ?? [];
  // The newest on top, as drawn.
  return [...highlights]
    .reverse()
    .find(
      (highlight) =>
        highlight.page === index + 1 &&
        highlight.segmentRects.some(
          (r) =>
            px >= r.x - HIT_SLOP &&
            px <= r.x + r.w + HIT_SLOP &&
            py >= r.y - HIT_SLOP &&
            py <= r.y + r.h + HIT_SLOP,
        ),
    );
}
