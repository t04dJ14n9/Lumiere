import { useViewportCapability } from "@embedpdf/plugin-viewport/react";
import {
  ZoomMode,
  useZoomCapability,
  type ZoomLevel,
} from "@embedpdf/plugin-zoom/react";
import { useEffect } from "react";

/**
 * Fit the PDF to the viewer as soon as the viewer has a size.
 *
 * EmbedPDF's zoom plugin re-fits an automatic zoom (fit width, fit page)
 * 150 ms after the viewport is resized, so a window being dragged is not
 * re-laid out on every frame. But the viewport first gets its size only
 * when the viewer mounts, after the document has loaded; the fit on load
 * found no size and did nothing. So the first fit waited out that debounce,
 * and with it every page: the viewport is gated until the zoom is known.
 * Asking for the same automatic zoom on that first size applies it at once;
 * the debounced re-fit then finds nothing to change, and later resizes keep
 * the debounce.
 */
export function useFirstFitNow(documentId: string): void {
  const { provides: viewport } = useViewportCapability();
  // Not `useZoom`: its `provides` is a new object on every render (which
  // would run this effect, and fit again, after every render, undoing
  // every jump), and it re-renders the viewer on every zoom change.
  const { provides: zoomCapability } = useZoomCapability();
  useEffect(() => {
    if (!viewport || !zoomCapability) {
      return;
    }
    const zoom = zoomCapability.forDocument(documentId);
    let fitted = false;
    const fitNow = (width: number, height: number): void => {
      if (fitted || width <= 0 || height <= 0) {
        return;
      }
      fitted = true;
      const level = zoom.getState().zoomLevel;
      if (isAutomatic(level)) {
        // The top of the view stays put, as in the plugin's own fit; the
        // default (the middle) would leave the first page scrolled down.
        zoom.requestZoom(level, { vx: width / 2, vy: 0 });
      }
    };
    const stop = viewport.onViewportResize(({ documentId: id, metrics }) => {
      if (id === documentId) {
        fitNow(metrics.clientWidth, metrics.clientHeight);
      }
    });
    // The size may have arrived before this listener.
    if (viewport.isViewportMounted(documentId)) {
      const { clientWidth, clientHeight } = viewport
        .forDocument(documentId)
        .getMetrics();
      fitNow(clientWidth, clientHeight);
    }
    return stop;
  }, [viewport, zoomCapability, documentId]);
}

function isAutomatic(level: ZoomLevel): boolean {
  return (
    level === ZoomMode.FitWidth ||
    level === ZoomMode.FitPage ||
    level === ZoomMode.Automatic
  );
}
