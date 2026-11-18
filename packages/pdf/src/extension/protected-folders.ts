import * as vscode from "vscode";
import { inProtectedFolder } from "../shared/annotation-store";

export const PROTECTED_FOLDERS = "lumiere.pdf.annotations.protectedFolders";

/**
 * Whether the PDF is in one of `lumiere.pdf.annotations.protectedFolders`
 * (a vault's sources, which must not change), so Lumiere never writes it.
 */
export function isProtectedPdf(uri: vscode.Uri): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return false;
  }
  const folders = vscode.workspace
    .getConfiguration(undefined, uri)
    .get<string[]>(PROTECTED_FOLDERS, [".raw"]);
  return inProtectedFolder(
    vscode.workspace.asRelativePath(uri, false),
    Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : [],
  );
}
