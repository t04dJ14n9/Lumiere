import * as vscode from "vscode";
import { t } from "@workshop/l10n";
import { parseVsCodeToolbarMode } from "../../../shared/toolbar-settings";
import type { PdfSettings } from "../../settings";
import { SECTION } from "./preferences";

type VsCodeToolbarMode = "chrome" | "none";

/** The places the controls can go; made when asked, so its text is in the reader's language. */
function modeChoices(): {
  mode: VsCodeToolbarMode;
  label: string;
  detail: string;
}[] {
  return [
    {
      mode: "chrome",
      label: `$(layout-statusbar) ${t("Status Bar")}`,
      detail: t(
        "Page, zoom, View, page colors and navigation on the VS Code status bar",
      ),
    },
    {
      mode: "none",
      label: `$(eye-closed) ${t("None")}`,
      detail: t(
        "No status-bar PDF entries: keyboard shortcuts, menus and the command palette only",
      ),
    },
  ];
}

/** Ask where the controls go, and save the answer in the setting the Settings editor shows. */
export async function selectToolbarMode(settings: PdfSettings): Promise<void> {
  const current = parseVsCodeToolbarMode(
    vscode.workspace.getConfiguration(SECTION).get("mode"),
  );
  const choice = await vscode.window.showQuickPick(
    modeChoices().map((choice) => ({
      ...choice,
      ...(choice.mode === current ? { description: t("current") } : {}),
    })),
    {
      title: t("PDF Viewer Controls"),
      placeHolder: t("Where should the page, zoom and find controls be?"),
    },
  );
  if (choice && choice.mode !== current) {
    await settings.update(`${SECTION}.mode`, choice.mode);
  }
}
