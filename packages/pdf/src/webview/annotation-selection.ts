import {
  AnnotationToken,
  useAnnotationState,
  type Annotation,
} from "@embedpdf/react/annotation";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect, useRef } from "react";
import {
  annotationQuoteText,
  selectionFromAnnotation,
} from "../shared/annotation-handoff";
import type { RegionSelection } from "../shared/selection";
import { postToHost } from "./host";

export type SetAnnotationRegion = (next: RegionSelection | undefined) => void;

/**
 * While Annotate mode is on, mirror EmbedPDF's selected annotations into the
 * host selection via SelectionTracker (same path as marquee regions) so Copy
 * Link for Agent / ensureSelection stay consistent, and expose delete.
 */
export function useAnnotationSelection(
  annotate: boolean,
  setAnnotationRegion: SetAnnotationRegion,
): {
  hasAnnotationSelection: boolean;
  deleteSelected: () => void;
  /** Someone is typing in a free-text box: Delete and Backspace edit its text. */
  editingText: boolean;
} {
  const annotation = useOptionalCapability(AnnotationToken);
  const documents = useDocuments();
  const selected = useAnnotationState((state) => state.selected);
  const editingText = useAnnotationState((state) => state.editing !== null);
  const owned = useRef(false);
  const setRegion = useRef(setAnnotationRegion);
  setRegion.current = setAnnotationRegion;

  useEffect(() => {
    if (!annotate) {
      annotation?.selection.clear();
    }
  }, [annotation, annotate]);

  const visible = annotate ? selected : NONE;
  const primary = visible[0];
  const primaryPage =
    primary === undefined ? -1 : documents.getPageIndex(primary.page);
  useEffect(() => {
    if (primary === undefined || primaryPage < 0) {
      clearOwnedAnnotationRegion(owned, setRegion.current);
      return;
    }
    applyAnnotationRegion(primary, primaryPage, owned, setRegion.current);
  }, [primary, primaryPage]);

  const deleteSelected = useCallback((): void => {
    if (!annotation || !annotate || selected.length === 0) {
      return;
    }
    annotation.selection.delete().catch((error: unknown) => {
      postToHost({
        type: "error",
        message: `Could not delete the annotation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    });
  }, [annotation, annotate, selected]);

  return {
    hasAnnotationSelection: visible.length > 0,
    deleteSelected,
    editingText,
  };
}

const NONE: readonly Annotation[] = [];

function clearOwnedAnnotationRegion(
  owned: { current: boolean },
  setAnnotationRegion: SetAnnotationRegion,
): void {
  if (!owned.current) {
    return;
  }
  owned.current = false;
  setAnnotationRegion(undefined);
}

function applyAnnotationRegion(
  primary: Annotation,
  pageIndex: number,
  owned: { current: boolean },
  setAnnotationRegion: SetAnnotationRegion,
): void {
  const quote = annotationQuoteText(
    typeof primary.contents === "string" ? { contents: primary.contents } : {},
  );
  const { x, y, width, height } = primary.rect;
  owned.current = true;
  setAnnotationRegion(
    selectionFromAnnotation({
      pageIndex,
      rect: { origin: { x, y }, size: { width, height } },
      ...(quote ? { text: quote } : {}),
    }),
  );
}
