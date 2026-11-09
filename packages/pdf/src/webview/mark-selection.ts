import {
  useAnnotationSelection,
  type SetAnnotationRegion,
} from "./annotation-selection";

/**
 * The marks selected in Annotate mode: EmbedPDF embedded annotations only.
 * Vault backlink overlays never enter this path (no hasAnnotationSelection),
 * so Delete/Backspace leave them alone.
 */
export function useMarkSelection(
  annotate: boolean,
  setAnnotationRegion: SetAnnotationRegion,
): ReturnType<typeof useAnnotationSelection> {
  return useAnnotationSelection(annotate, setAnnotationRegion);
}
