import type { PdfDocumentObject } from "@embedpdf/models";
import {
  useAnnotationSelection,
  type SetAnnotationRegion,
} from "./annotation-selection";
import { DOCUMENT_ID } from "./plugins";
import { useSidecarHighlightWriting } from "./sidecar-writing";
import { useSidecarReattach } from "./sidecar-reattach";
import { useSidecarSelection } from "./sidecar-selection";

/**
 * The marks selected in Annotate mode: the PDF's own (EmbedPDF) or a
 * sidecar highlight, never both. Sidecar highlights are written as the tool
 * finishes a selection, and re-attached when the PDF changed under them.
 * Vault backlink overlays never enter this path (no hasAnnotationSelection),
 * so Delete/Backspace leave them alone.
 */
export function useMarkSelection(
  pdf: PdfDocumentObject,
  annotate: boolean,
  setAnnotationRegion: SetAnnotationRegion,
): { hasAnnotationSelection: boolean; deleteSelected: () => void } {
  useSidecarHighlightWriting(pdf);
  useSidecarReattach(pdf);
  const embedded = useAnnotationSelection(
    DOCUMENT_ID,
    pdf,
    annotate,
    setAnnotationRegion,
  );
  // After EmbedPDF's: its region is cleared before a sidecar mark reports its own.
  const sidecar = useSidecarSelection(pdf, annotate, setAnnotationRegion);
  return {
    hasAnnotationSelection:
      embedded.hasAnnotationSelection || sidecar.hasSelection,
    deleteSelected: sidecar.hasSelection
      ? sidecar.deleteSelected
      : embedded.deleteSelected,
  };
}
