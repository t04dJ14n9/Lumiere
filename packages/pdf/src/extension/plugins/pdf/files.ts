import { createHash } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type { PdfFiles } from "../../../shared/host";
import type { PdfFile } from "../../../shared/pdf-backlink-index";
import { writeAtomicFile } from "../../../host/atomic-write";

/** PDF files through VS Code's file system, so remote and virtual files open too. */
export const vscodePdfFiles: PdfFiles = {
  read: (uri) =>
    Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(uri))),
  watch: (uri, onChange) => watchFile(vscode.Uri.parse(uri), onChange),
  displayPath: (uri) => displayPath(vscode.Uri.parse(uri)),
  hash: async (uri) => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
    return createHash("sha256").update(bytes).digest("hex");
  },
  writeAtomic: async (uri, bytes) => {
    const parsed = vscode.Uri.parse(uri);
    if (parsed.scheme !== "file") {
      throw new Error("In-place annotation save requires a local file URI");
    }
    return writeAtomicFile(parsed.fsPath, bytes);
  },
};

function watchFile(uri: vscode.Uri, onChange: () => void): () => void {
  if (uri.scheme !== "file") {
    return () => undefined;
  }
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(uri.fsPath)),
      path.basename(uri.fsPath),
    ),
  );
  const subscriptions = [
    watcher.onDidChange(onChange),
    watcher.onDidCreate(onChange),
  ];
  return () => {
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
    watcher.dispose();
  };
}

/** The path agents should use: workspace-relative when possible. */
export function displayPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
}

/**
 * Where a file is for the backlink index: its workspace folder, and its path
 * in it (`displayPath`). That path alone names two files in a multi-root
 * workspace whose folders both hold `papers/a.pdf`. A file outside every
 * folder has no folder (`""`) and its absolute path.
 */
export function workspaceLocation(uri: vscode.Uri): PdfFile {
  return {
    folder: vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? "",
    path: displayPath(uri),
  };
}
