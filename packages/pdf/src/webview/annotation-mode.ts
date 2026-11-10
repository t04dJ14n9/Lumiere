import {
  AnnotationToken,
  useFilePickerProvider,
  type AnnotationCapability,
} from "@embedpdf/react/annotation";
import { HistoryToken, useHistoryState } from "@embedpdf/react/history";
import { useInteractionState } from "@embedpdf/react/interaction";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import {
  InteractionToken,
  type InteractionHostCapability,
} from "@embedpdf/plugin-interaction/contract/host";
import { useCallback, useEffect } from "react";
import {
  ANNOTATE_IDLE_TOOL_ID,
  DEFAULT_ANNOTATION_TOOL,
  READ_TOOL_ID,
  type AnnotationToolId,
  fromV3ToolId,
  isAnnotateModeTool,
  toV3ToolId,
  toolColorDefaults,
} from "../shared/annotation-tools";
import { highlightToolDefaults } from "../shared/highlight-style";
import { currentPageColors, onPageColorsChange } from "./page-colors";

/** Active EmbedPDF annotation tool + History undo/redo for the open document. */
export type AnnotationMode = {
  annotationTool: AnnotationToolId | null;
  setAnnotationTool: (tool: AnnotationToolId | null) => void;
  setColor: (color: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * The drawing tool, its colour and undo/redo. Call it once: it also lets the
 * Stamp tool open a file dialog (`useFilePickerProvider` is one per document).
 */
export function useAnnotationMode(): AnnotationMode {
  const annotation = useOptionalCapability(AnnotationToken);
  const interaction = useOptionalCapability(InteractionToken);
  const history = useOptionalCapability(HistoryToken);
  const activeToolId = useInteractionState((state) => state.activeToolId);
  const canUndo = useHistoryState((state) => state.canUndo);
  const canRedo = useHistoryState((state) => state.canRedo);
  useFilePickerProvider();
  useHighlightPaperDefaults(annotation);
  const annotationTool = fromV3ToolId(activeToolId);

  const setAnnotationTool = useCallback(
    (tool: AnnotationToolId | null) => {
      interaction?.activateTool(
        tool ? toV3ToolId(tool) : ANNOTATE_IDLE_TOOL_ID,
      );
    },
    [interaction],
  );

  const setColor = useCallback(
    (color: string) => {
      const tool = annotationTool ?? DEFAULT_ANNOTATION_TOOL;
      const defaults = toolColorDefaults(tool, color, currentPageColors());
      if (Object.keys(defaults).length > 0) {
        annotation?.tools.updateDefaults(toV3ToolId(tool), defaults);
      }
    },
    [annotation, annotationTool],
  );

  const undo = useCallback(() => history?.undo(), [history]);
  const redo = useCallback(() => history?.redo(), [history]);

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

/**
 * Whether Annotate mode is on, and the way in and out of it. Call it once
 * (it registers View mode's tool). The mode is the interaction hub's active
 * tool, so it follows `setAnnotationTool` and the Esc/exit paths with no state
 * of its own.
 */
export function useAnnotateSwitch(): {
  annotate: boolean;
  enterAnnotate: () => void;
  leaveAnnotate: () => void;
} {
  const interaction = useOptionalCapability(InteractionToken);
  const annotation = useOptionalCapability(AnnotationToken);
  const activeToolId = useInteractionState((state) => state.activeToolId);
  const hasReadTool = useInteractionState((state) =>
    state.tools.some((tool) => tool.id === READ_TOOL_ID),
  );
  useReadTool(interaction);

  // `pointer` is Annotate's resting tool, but until View's tool is registered
  // it is also what a document opens on.
  const annotate = hasReadTool && isAnnotateModeTool(activeToolId);

  // A markup tool picked while text is selected marks that text at once, so
  // the caller clears the text selection first.
  const enterAnnotate = useCallback(() => {
    interaction?.activateTool(toV3ToolId(DEFAULT_ANNOTATION_TOOL));
  }, [interaction]);
  // Switching tool also drops a drawing in progress and the armed stamp.
  const leaveAnnotate = useCallback(() => {
    annotation?.selection.clear();
    interaction?.activateTool(READ_TOOL_ID);
  }, [annotation, interaction]);

  return { annotate, enterAnnotate, leaveAnnotate };
}

/**
 * View mode's interaction tool: text selection, links, and Stage pan on empty
 * page space (`scroll`). EmbedPDF's built-in `pointer` tool also edits
 * annotations, which would let a reader change what came with the PDF. The
 * public tool type has no behaviour tags, so this is registered through the
 * host token. `scroll` lets Stage's pan handler take a press that text
 * selection declined (blank area), and in page-by-page scrolling a drag that
 * meets the edge turns the page (`turnGestures`).
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

function useReadTool(interaction: InteractionHostCapability | null): void {
  useEffect(() => {
    if (!interaction) {
      return;
    }
    const remove = interaction.hasTool(READ_TOOL_ID)
      ? undefined
      : interaction.registerTool(readTool());
    if (interaction.getActiveToolId() === ANNOTATE_IDLE_TOOL_ID) {
      interaction.activateTool(READ_TOOL_ID);
    }
    return remove;
  }, [interaction]);
}

/** Keep highlight tool defaults aligned with effective paper (Follow/Normal/Dark). */
function useHighlightPaperDefaults(
  annotation: AnnotationCapability | null,
): void {
  useEffect(() => {
    if (!annotation) {
      return;
    }
    const sync = (): void => {
      annotation.tools.updateDefaults(
        toV3ToolId(DEFAULT_ANNOTATION_TOOL),
        highlightToolDefaults(currentPageColors()),
      );
    };
    sync();
    return onPageColorsChange(sync);
  }, [annotation]);
}
