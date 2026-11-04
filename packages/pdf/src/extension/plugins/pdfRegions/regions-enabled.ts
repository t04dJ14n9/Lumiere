import * as vscode from "vscode";

/**
 * Whether empty-page Select Region / viewrect Copy link is on.
 * Setting `lumiere.pdf.regions.enabled` (default false) is owned by pdfRegions.
 */
export function isRegionsEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("lumiere.pdf")
      .get<boolean>("regions.enabled", false) === true
  );
}
