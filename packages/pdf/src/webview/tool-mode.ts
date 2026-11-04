import {
  useInteractionManager,
  useInteractionManagerCapability,
} from "@embedpdf/plugin-interaction-manager/react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_ANNOTATION_TOOL } from "../shared/annotation-tools";
import { highlightToolDefaults } from "../shared/highlight-style";
import { currentPageColors } from "./page-colors";
import type { ToolMode } from "../shared/view-state";
import { currentViewSettings } from "./reading-position";
import { touchOnly } from "./touch";

/**
 * EmbedPDF's interaction mode for the Select Region tool: drags draw a
 * region anywhere on a page, over text too. The default mode ("text" here)
 * selects text, and a region only when the drag starts on empty space —
 * and only when `lumiere.pdf.regions.enabled` is on.
 */
const REGION_MODE = "lumiere.pdf.selectRegion";

/** The current tool and a way to change it. */
export function useToolMode(
  documentId: string,
  regionsEnabled = currentViewSettings().regionsEnabled,
): {
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;
} {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: selection } = useSelectionCapability();
  const { provides: annots } = useAnnotationCapability();
  const { state } = useInteractionManager(documentId);
  const [annotate, setAnnotate] = useState(false);

  useEffect(() => {
    registerToolModes(documentId, interaction, selection, regionsEnabled);
  }, [documentId, interaction, selection, regionsEnabled]);

  useEffect(() => {
    if (regionsEnabled) {
      return;
    }
    const scope = interaction?.forDocument(documentId);
    if (!scope) {
      return;
    }
    if (state.activeMode === REGION_MODE) {
      scope.activateDefaultMode();
    }
  }, [documentId, interaction, regionsEnabled, state.activeMode]);

  const setTool = useCallback(
    (tool: ToolMode): void => {
      const scope = interaction?.forDocument(documentId);
      if (!scope) {
        return;
      }
      if (tool === "annotate") {
        selection?.forDocument(documentId).clear();
        scope.activateDefaultMode();
        // Override EmbedPDF stock #FFCD45@1 so built-in matches sidecar light yellow.
        annots?.setToolDefaults(
          DEFAULT_ANNOTATION_TOOL,
          highlightToolDefaults(currentPageColors()) as never,
        );
        annots?.forDocument(documentId).setActiveTool(DEFAULT_ANNOTATION_TOOL);
        setAnnotate(true);
        return;
      }
      annots?.forDocument(documentId).setActiveTool(null);
      setAnnotate(false);
      if (tool === "region") {
        if (!regionsEnabled) {
          scope.activateDefaultMode();
          return;
        }
        // A text selection would stay on screen, unreachable by region drags.
        selection?.forDocument(documentId).clear();
        scope.activate(REGION_MODE);
      } else {
        scope.activateDefaultMode();
      }
    },
    [documentId, interaction, selection, annots, regionsEnabled],
  );

  return {
    tool: resolveToolMode(annotate, state.activeMode, regionsEnabled),
    setTool,
  };
}

function resolveToolMode(
  annotate: boolean,
  activeMode: string,
  regionsEnabled: boolean,
): ToolMode {
  if (annotate) {
    return "annotate";
  }
  if (regionsEnabled && activeMode === REGION_MODE) {
    return "region";
  }
  return "text";
}

function registerToolModes(
  documentId: string,
  interaction: ReturnType<typeof useInteractionManagerCapability>["provides"],
  selection: ReturnType<typeof useSelectionCapability>["provides"],
  regionsEnabled: boolean,
): void {
  if (!interaction || !selection) {
    return;
  }
  if (touchOnly()) {
    // EmbedPDF's default mode takes every touch (touch-action: none) for
    // its drags; on a touch-only device it leaves them to the browser, so
    // a finger scrolls. Registering the mode again replaces it.
    interaction.registerMode({
      id: interaction.getDefaultMode(),
      scope: "page",
      exclusive: false,
      cursor: "auto",
      wantsRawTouch: false,
    });
  }
  // Explicitly gate empty-space marquee on the default (text) mode.
  selection.enableForMode(
    interaction.getDefaultMode(),
    { enableSelection: true, enableMarquee: regionsEnabled },
    documentId,
  );
  if (!regionsEnabled) {
    return;
  }
  interaction.registerMode({
    id: REGION_MODE,
    scope: "page",
    exclusive: false,
    cursor: "crosshair",
  });
  selection.enableForMode(
    REGION_MODE,
    { enableSelection: false, enableMarquee: true },
    documentId,
  );
}
