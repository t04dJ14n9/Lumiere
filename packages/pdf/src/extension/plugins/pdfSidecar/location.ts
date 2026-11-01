import * as vscode from "vscode";
import {
  sidecarFileName,
  sidecarPlacement,
} from "../../../shared/sidecar-path";

export const LOCATION_SETTING = "lumiere.pdf.sidecar.location";
export const DIRECTORY_SETTING = "lumiere.pdf.sidecar.directory";

/** The sidecar of one PDF: the file, and whom it belongs to. */
export interface SidecarFile {
  readonly uri: vscode.Uri;
  /** Written into a new sidecar's front matter, and checked before writing one. */
  readonly owner: { source: string; path?: string };
}

/**
 * Where the sidecar of `pdf` is read and written.
 *
 * Beside the PDF by default. With `location: directory`, flat in that folder
 * of the PDF's workspace; there, an existing sidecar beside the PDF still
 * wins until the reader moves it, so notes written before the setting changed
 * stay in one file. A PDF outside the workspace, or a folder setting that
 * cannot be used (`warn` says why), keeps its sidecar beside it.
 */
export async function locateSidecar(
  pdf: vscode.Uri,
  warn: (message: string) => void,
): Promise<SidecarFile> {
  const name = pdf.path.slice(pdf.path.lastIndexOf("/") + 1);
  const sibling: SidecarFile = {
    uri: vscode.Uri.joinPath(pdf, "..", sidecarFileName(name)),
    owner: { source: name },
  };
  const settings = vscode.workspace.getConfiguration(undefined, pdf);
  const placement = sidecarPlacement(
    settings.get(LOCATION_SETTING),
    settings.get(DIRECTORY_SETTING),
  );
  if (placement.kind === "misconfigured") {
    warn(`${placement.reason}. PDF highlights are kept beside the PDF.`);
    return sibling;
  }
  const workspace = vscode.workspace.getWorkspaceFolder(pdf);
  if (placement.kind === "sibling" || !workspace) {
    return sibling;
  }
  const primary: SidecarFile = {
    uri: vscode.Uri.joinPath(
      workspace.uri,
      ...placement.folder,
      sidecarFileName(name),
    ),
    owner: {
      source: name,
      path: vscode.workspace.asRelativePath(pdf, false),
    },
  };
  if (!(await exists(primary.uri)) && (await exists(sibling.uri))) {
    return sibling;
  }
  return primary;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
