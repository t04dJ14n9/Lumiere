import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ANNOTATION_TOOL,
  type AnnotationToolId,
  isAnnotationToolId,
} from "../shared/annotation-tools";
import { highlightToolDefaults } from "../shared/highlight-style";
import { currentPageColors, onPageColorsChange } from "./page-colors";

const HISTORY_TOPIC = "annotations";

/** Active EmbedPDF annotation tool + History undo/redo for one document. */
export type AnnotationMode = {
  annotationTool: AnnotationToolId | null;
  setAnnotationTool: (tool: AnnotationToolId | null) => void;
  setColor: (color: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useAnnotationMode(documentId: string): AnnotationMode {
  const { provides: annots } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();
  const [annotationTool, setAnnotationToolState] =
    useState<AnnotationToolId | null>(null);
  const { canUndo, canRedo } = useAnnotationHistory(documentId, history);
  useHighlightPaperDefaults(annots);

  useEffect(() => {
    if (!annots) {
      return;
    }
    return annots.onActiveToolChange(({ documentId: id, tool }) => {
      if (id !== documentId) {
        return;
      }
      const next = tool?.id;
      setAnnotationToolState(isAnnotationToolId(next) ? next : null);
    });
  }, [annots, documentId]);

  const setAnnotationTool = useCallback(
    (tool: AnnotationToolId | null) => {
      annots?.forDocument(documentId).setActiveTool(tool);
      setAnnotationToolState(tool);
    },
    [annots, documentId],
  );

  const setColor = useCallback(
    (color: string) => {
      const id = annotationTool ?? DEFAULT_ANNOTATION_TOOL;
      annots?.setToolDefaults(
        id,
        highlightToolDefaults(currentPageColors(), color) as never,
      );
    },
    [annots, annotationTool],
  );

  const undo = useCallback(
    () => runAnnotationHistory(history, documentId, "undo"),
    [history, documentId],
  );
  const redo = useCallback(
    () => runAnnotationHistory(history, documentId, "redo"),
    [history, documentId],
  );

  return {
    annotationTool,
    setAnnotationTool,
    setColor,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

/** Keep highlight tool defaults aligned with effective paper (Follow/Normal/Dark). */
function useHighlightPaperDefaults(
  annots: ReturnType<typeof useAnnotationCapability>["provides"],
): void {
  useEffect(() => {
    if (!annots) {
      return;
    }
    const sync = (): void => {
      annots.setToolDefaults(
        DEFAULT_ANNOTATION_TOOL,
        highlightToolDefaults(currentPageColors()) as never,
      );
    };
    sync();
    return onPageColorsChange(sync);
  }, [annots]);
}

function runAnnotationHistory(
  history: ReturnType<typeof useHistoryCapability>["provides"],
  documentId: string,
  direction: "undo" | "redo",
): void {
  const scope = history?.forDocument(documentId);
  if (!scope) {
    return;
  }
  // Prefer the annotations topic; fall back to global if topic is empty
  // (e.g. after a partial history rebuild) so Host GUI Undo still works.
  if (direction === "undo") {
    if (scope.canUndo(HISTORY_TOPIC)) {
      scope.undo(HISTORY_TOPIC);
    } else if (scope.canUndo()) {
      scope.undo();
    }
    return;
  }
  if (scope.canRedo(HISTORY_TOPIC)) {
    scope.redo(HISTORY_TOPIC);
  } else if (scope.canRedo()) {
    scope.redo();
  }
}

function useAnnotationHistory(
  documentId: string,
  history: ReturnType<typeof useHistoryCapability>["provides"],
): { canUndo: boolean; canRedo: boolean } {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  useEffect(() => {
    if (!history) {
      return;
    }
    const scope = history.forDocument(documentId);
    const refresh = (): void => {
      setCanUndo(scope.canUndo(HISTORY_TOPIC) || scope.canUndo());
      setCanRedo(scope.canRedo(HISTORY_TOPIC) || scope.canRedo());
    };
    refresh();
    return scope.onHistoryChange(() => refresh());
  }, [history, documentId]);
  return { canUndo, canRedo };
}
