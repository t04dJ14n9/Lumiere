import * as vscode from "vscode";
import { changedSpan } from "../../../shared/sidecar-format";

/**
 * The text of a sidecar: the open editor's, unsaved edits included, or the
 * file's; undefined when there is no file yet.
 */
export async function readSidecar(
  uri: vscode.Uri,
): Promise<string | undefined> {
  const open = openDocument(uri);
  if (open) {
    return open.getText();
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (
      error instanceof vscode.FileSystemError &&
      error.code === "FileNotFound"
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Replace the sidecar's text. While it is open in an editor, the
 * TextDocument owns its text: the change is a workspace edit of just the
 * part that changed, then saved, so the editor keeps its place and undo.
 */
export async function writeSidecar(
  uri: vscode.Uri,
  before: string | undefined,
  after: string,
): Promise<void> {
  const open = openDocument(uri);
  if (open) {
    const span = changedSpan(open.getText(), after);
    if (span) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(
          open.positionAt(span.start),
          open.positionAt(span.end),
        ),
        span.text,
      );
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error(`Could not edit ${uri.fsPath}`);
      }
    }
    await open.save();
    return;
  }
  if (before === undefined) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(after));
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === key,
  );
}
