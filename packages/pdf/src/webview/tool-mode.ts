import {
  InteractionToken,
  type InteractionHostCapability,
} from "@embedpdf/plugin-interaction/contract/host";
import { SelectionToken } from "@embedpdf/plugin-selection/contract";
import { useInteractionState } from "@embedpdf/react/interaction";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect } from "react";
import { READ_TOOL_ID } from "../shared/annotation-tools";
import type { ToolMode } from "../shared/view-state";
import { useAnnotateSwitch } from "./annotation-mode";
import { REGION_TOOL_ID, registerRegionTools } from "./region-tool";
import { currentViewSettings } from "./reading-position";

/**
 * The current tool and a way to change it. The tool is the interaction hub's
 * active one, so nothing here keeps a copy of it: reading is the `lumia.read`
 * tool (annotation-mode.ts registers it), Annotate is a drawing tool, and
 * Select Region is this file's.
 */
export function useToolMode(
  regionsEnabled = currentViewSettings().regionsEnabled,
): {
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;
} {
  const interaction = useOptionalCapability(InteractionToken);
  const selection = useOptionalCapability(SelectionToken);
  const activeToolId = useInteractionState((state) => state.activeToolId);
  const { annotate, enterAnnotate, leaveAnnotate } = useAnnotateSwitch();
  useRegionTools(interaction, regionsEnabled, activeToolId);

  const setTool = useCallback(
    (tool: ToolMode): void => {
      if (tool === "annotate") {
        selection?.clear();
        enterAnnotate();
      } else if (
        tool === "region" &&
        regionsEnabled &&
        interaction?.hasTool(REGION_TOOL_ID)
      ) {
        // A text selection would stay on screen, unreachable by region drags.
        selection?.clear();
        if (annotate) {
          leaveAnnotate();
        }
        interaction.activateTool(REGION_TOOL_ID);
      } else {
        leaveAnnotate();
      }
    },
    [
      interaction,
      selection,
      regionsEnabled,
      annotate,
      enterAnnotate,
      leaveAnnotate,
    ],
  );

  return {
    tool: resolveToolMode(annotate, activeToolId, regionsEnabled),
    setTool,
  };
}

function resolveToolMode(
  annotate: boolean,
  activeToolId: string | null,
  regionsEnabled: boolean,
): ToolMode {
  if (annotate) {
    return "annotate";
  }
  return regionsEnabled && activeToolId === REGION_TOOL_ID ? "region" : "text";
}

/**
 * Have the Select Region tool and the empty-space drag only while
 * `lumiere.pdf.regions.enabled` is on, and put the tool down when it goes
 * off. A tool removed while active stays active as an inert one, so the
 * reader is put back on the reading tool.
 */
function useRegionTools(
  interaction: InteractionHostCapability | null,
  regionsEnabled: boolean,
  activeToolId: string | null,
): void {
  const documents = useDocuments();
  useEffect(() => {
    if (!interaction || !regionsEnabled) {
      return;
    }
    return registerRegionTools(
      interaction,
      (page) => documents.getPage(page)?.size,
    );
  }, [interaction, regionsEnabled, documents]);
  useEffect(() => {
    if (!regionsEnabled && activeToolId === REGION_TOOL_ID) {
      interaction?.activateTool(READ_TOOL_ID);
    }
  }, [interaction, regionsEnabled, activeToolId]);
}
