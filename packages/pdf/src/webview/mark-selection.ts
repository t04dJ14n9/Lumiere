import type { PdfDocumentObject } from "@embedpdf/models";
import {
  useAnnotationSelection,
  type SetAnnotationRegion,
} from "./annotation-selection";
import { DOCUMENT_ID } from "./plugins";

/**
 * The marks selected in Annotate mode: EmbedPDF embedded annotations only.
 * Sidecar create/delete UI is torn down; legacy `#hl-` open flashes via host
 * `goTo` without painting sidecar overlays. Vault backlink overlays never
 * enter this path (no hasAnnotationSelection), so Delete/Backspace leave them
 * alone.
 */
export function useMarkSelection(
  pdf: PdfDocumentObject,
  annotate: boolean,
  setAnnotationRegion: SetAnnotationRegion,
): { hasAnnotationSelection: boolean; deleteSelected: () => void } {
  const embedded = useAnnotationSelection(
    DOCUMENT_ID,
    pdf,
    annotate,
    setAnnotationRegion,
  );
  return {
    hasAnnotationSelection: embedded.hasAnnotationSelection,
    deleteSelected: embedded.deleteSelected,
  };
}
