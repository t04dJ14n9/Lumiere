import * as vscode from "vscode";
import type { Plugin } from "@workshop/core";
import { highlightIdOfFragment } from "../../../shared/sidecar-format";
import type { PdfPanel } from "../pdf/panel";
import type { PdfPanels } from "../pdf/panels";
import type {} from "../services";
import { DIRECTORY_SETTING, LOCATION_SETTING } from "./location";
import manifest from "./manifest";
import { Sidecars } from "./sidecars";

/**
 * Legacy PDF sidecar highlights (`paper.pdf.lumiere.md`): read + `#hl-…` open
 * only. New highlights live in vault Markdown / burn into the PDF via EmbedPDF;
 * all sidecarWrite ops are ignored. Stopping the plugin clears the read claim.
 */
export const pdfSidecarPlugin: Plugin = {
  name: manifest.id,
  inject: { required: ["pdfPanels"] },
  apply(ctx) {
    const panels = ctx.pdfPanels;
    const sidecars = new Sidecars();
    ctx.own(sidecars, "sidecars and their file watchers");
    followPanels(ctx, panels, sidecars);
    ctx.own(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(LOCATION_SETTING) ||
          event.affectsConfiguration(DIRECTORY_SETTING)
        ) {
          sidecars.relocateAll();
        }
      }),
      "settings listener",
    );
    ctx.own(
      panels.handle("sidecarWrite", (panel, message) =>
        sidecars.write(panel, message),
      ),
      "message handler",
    );
    ctx.own(
      panels.handleFragment({
        accepts: (fragment) => highlightIdOfFragment(fragment) !== undefined,
        open: (panel, fragment) =>
          sidecars.reveal(panel, highlightIdOfFragment(fragment)!),
      }),
      "#hl- links",
    );
  },
};

/** Keep the sidecar of every PDF editor, from when it opens until it closes. */
function followPanels(
  ctx: Parameters<Plugin["apply"]>[0],
  panels: PdfPanels,
  sidecars: Sidecars,
): void {
  const follow = (panel: PdfPanel): void => {
    sidecars.open(panel);
    ctx.own(
      panel.webviewPanel.onDidDispose(() => sidecars.close(panel)),
      `close:${panel.viewId}`,
    );
  };
  for (const panel of panels.all) {
    follow(panel);
  }
  ctx.own(panels.onDidOpen(follow), "open listener");
}
