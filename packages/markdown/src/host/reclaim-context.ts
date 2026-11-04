import * as vscode from "vscode";
import {
  associatedWith,
  isReclaimableNote,
  reclaimEnabled,
  type TabKind,
} from "./reclaim-policy";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";
import { hasNativeOptOut } from "./reclaim-opt-out";

const { viewType } = MARKDOWN_EDITOR;

export function reclaimContext(
  uri: string,
  workspaceDefault: boolean,
  after: TabKind = "text",
) {
  const target = vscode.Uri.parse(uri);
  const editor = vscode.workspace.getConfiguration("lumiere.markdown", target);
  return {
    enabled: reclaimEnabled(
      {
        mode: editor.get<"auto" | "on" | "off">(
          "editor.reclaimTextEditor",
          "auto",
        ),
        appName: vscode.env.appName,
      },
      workspaceDefault,
    ),
    reclaimInPlace: editor.get("editor.reclaimInPlaceTextEditor", false),
    isNote: isReclaimableNote,
    associated: (value: string) =>
      associatedWith(
        vscode.workspace
          .getConfiguration("workbench", target)
          .get("editorAssociations"),
        value,
        viewType,
        workspaceDefault,
      ),
    bypassed: (value: string) => hasNativeOptOut(value, after),
  };
}
