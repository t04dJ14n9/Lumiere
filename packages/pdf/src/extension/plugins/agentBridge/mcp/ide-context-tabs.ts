/** The Lumiere tabs (notes and PDFs) open in this window, for the IDE context. */
import * as vscode from "vscode";
import { KNOWN_LUMIERE_VIEW_TYPES } from "@workshop/agents/ide-context";

export interface LumiereTab {
  kind: "note" | "pdf";
  /** Relative to its workspace folder. */
  path: string;
  /** The tab its group shows (each editor group shows one). */
  visible: boolean;
  /** The tab the user is in: shown by the group that has the focus. */
  active: boolean;
  dirty: boolean;
}

const KINDS: Record<string, LumiereTab["kind"]> = {
  "lumiere.markdown.editor": "note",
  "lumiere.pdf.viewer": "pdf",
};

/** The Lumiere editor a tab input is, as a custom editor of one of Lumiere's view types. */
function lumiereInput(
  input: unknown,
): { uri: vscode.Uri; kind: LumiereTab["kind"] } | undefined {
  const { uri, viewType } = (input ?? {}) as {
    uri?: vscode.Uri;
    viewType?: string;
  };
  const known = KNOWN_LUMIERE_VIEW_TYPES as readonly string[];
  if (!uri || !viewType || !known.includes(viewType)) {
    return undefined;
  }
  const kind = KINDS[viewType];
  return kind ? { uri, kind } : undefined;
}

/**
 * Lumiere's tabs in the window, at most `max`, and the kind of the one the
 * user is in. A tab whose file is outside the workspace folders is counted,
 * not listed: the list names workspace paths only.
 */
export function listLumiereTabs(max: number): {
  tabs: LumiereTab[];
  focus?: LumiereTab["kind"];
  outside: number;
  /** Tabs left out for the cap. */
  cut: number;
} {
  const tabs: LumiereTab[] = [];
  let focus: LumiereTab["kind"] | undefined;
  let outside = 0;
  let cut = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = lumiereInput(tab.input);
      if (!input) {
        continue;
      }
      const active = group.isActive && tab.isActive;
      focus = active ? input.kind : focus;
      if (!vscode.workspace.getWorkspaceFolder(input.uri)) {
        outside++;
      } else if (tabs.length >= max) {
        cut++;
      } else {
        tabs.push({
          kind: input.kind,
          path: vscode.workspace.asRelativePath(input.uri, false),
          visible: tab.isActive,
          active,
          dirty: tab.isDirty,
        });
      }
    }
  }
  return { tabs, ...(focus ? { focus } : {}), outside, cut };
}
