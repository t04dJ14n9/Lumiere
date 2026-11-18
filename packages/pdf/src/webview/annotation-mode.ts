import {
  AnnotationToken,
  type AnnotationCapability,
} from "@embedpdf/react/annotation";
import { HistoryToken } from "@embedpdf/react/history";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import {
  InteractionToken,
  type InteractionHostCapability,
} from "@embedpdf/plugin-interaction/contract/host";
import { useCallback, useEffect } from "react";
import { READ_TOOL_ID } from "../shared/annotation-tools";
import { highlightToolDefaults } from "../shared/highlight-style";
import { currentPageColors, onPageColorsChange } from "./page-colors";

/** EmbedPDF's resting tool, which a document opens on before the reading tool is registered. */
const POINTER_TOOL_ID = "pointer";

/**
 * Undo and redo of annotation changes, and the highlight colour new marks
 * take. Call it once per document: it keeps the highlight tool's defaults in
 * step with the paper.
 */
export function useAnnotationEditing(): {
  undo: () => void;
  redo: () => void;
  /** New highlights take this colour (the last one picked from Change Color). */
  setHighlightColor: (color: string) => void;
} {
  const annotation = useOptionalCapability(AnnotationToken);
  const history = useOptionalCapability(HistoryToken);
  useHighlightPaperDefaults(annotation);
  const undo = useCallback(() => history?.undo(), [history]);
  const redo = useCallback(() => history?.redo(), [history]);
  const setHighlightColor = useCallback(
    (color: string) => {
      highlightColor = color;
      syncHighlightDefaults(annotation);
    },
    [annotation],
  );
  return { undo, redo, setHighlightColor };
}

/**
 * The colour of new highlights, once one was picked; until then, the
 * paper's own. Kept for the window, so every open PDF follows the last pick.
 */
let highlightColor: string | undefined;

/** Keep highlight tool defaults aligned with effective paper (Follow/Normal/Dark). */
function useHighlightPaperDefaults(
  annotation: AnnotationCapability | null,
): void {
  useEffect(() => {
    if (!annotation) {
      return;
    }
    syncHighlightDefaults(annotation);
    return onPageColorsChange(() => syncHighlightDefaults(annotation));
  }, [annotation]);
}

function syncHighlightDefaults(annotation: AnnotationCapability | null): void {
  annotation?.tools.updateDefaults(
    "highlight",
    highlightToolDefaults(currentPageColors(), highlightColor),
  );
}

/**
 * Put the reader on the reading tool, the only one there is: text
 * selection, links and empty-page pan. Call it once per document.
 */
export function useReadTool(): void {
  const interaction = useOptionalCapability(InteractionToken);
  useEffect(() => registerReadTool(interaction), [interaction]);
}

/**
 * The reading tool: text selection, links, and Stage pan on empty page
 * space (`scroll`). EmbedPDF's built-in `pointer` tool also edits
 * annotations, which would let a click move or delete a mark; marks change
 * only from the context menu. The public tool type has no behaviour tags,
 * so this is registered through the host token. `scroll` lets Stage's pan
 * handler take a press that text selection declined (blank area) in
 * continuous scrolling. Page-by-page turns from a blank-area drag are
 * handled separately (`paged-drag-navigate`).
 */
export function readTool(): {
  id: string;
  cursor: "default";
  enables: Set<string>;
} {
  return {
    id: READ_TOOL_ID,
    cursor: "default",
    enables: new Set(["text-select", "link-nav", "scroll"]),
  };
}

function registerReadTool(
  interaction: InteractionHostCapability | null,
): (() => void) | undefined {
  if (!interaction) {
    return undefined;
  }
  const remove = interaction.hasTool(READ_TOOL_ID)
    ? undefined
    : interaction.registerTool(readTool());
  if (interaction.getActiveToolId() === POINTER_TOOL_ID) {
    interaction.activateTool(READ_TOOL_ID);
  }
  return remove;
}
