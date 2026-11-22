import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as vscode from "vscode";
import type * as EngineModule from "./engine";
import { insideFolders } from "./inside-folders";
import { PdfOutlineReader, type OutlineFiles } from "./reader";

/**
 * Reads PDFs through the editor's file system, so a remote workspace's PDFs
 * are read where the extension host runs.
 */
const workspaceFiles: OutlineFiles = {
  async stat(uri) {
    try {
      const { mtime, size } = await vscode.workspace.fs.stat(
        vscode.Uri.parse(uri),
      );
      return { mtime, size };
    } catch {
      return undefined;
    }
  },
  async read(uri) {
    return vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
  },
};

/**
 * `workspaceFiles` for the PDFs of this window's workspace folders only: any
 * other PDF reads as missing (see `insideFolders`).
 */
export const workspacePdfFiles: OutlineFiles = insideFolders(
  workspaceFiles,
  localWorkspaceFolders,
);

/**
 * The reader of PDF bookmarks that Lumiere offers to notes (`[[paper.pdf#`).
 * PDFium is the viewer's: the engine bundle is built beside the viewer and
 * loads the viewer's embedpdf.wasm, both from dist/pdf/ in the extension.
 */
export function createPdfOutlines(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): PdfOutlineReader {
  const assets = path.join(context.extensionPath, "dist", "pdf");
  return new PdfOutlineReader({
    files: workspacePdfFiles,
    engine: async () => {
      // A file URL, which `import` needs for an absolute path on Windows.
      const { createOutlineEngine } = (await import(
        pathToFileURL(path.join(assets, "outline-engine.js")).href
      )) as typeof EngineModule;
      return createOutlineEngine(
        await readFile(path.join(assets, "webview", "embedpdf.wasm")),
      );
    },
    log: (message) => log.warn(message),
  });
}

/** The paths of the workspace's folders on this machine's disk. */
function localWorkspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
}
