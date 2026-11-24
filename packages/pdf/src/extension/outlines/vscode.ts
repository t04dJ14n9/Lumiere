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
  /** A file's stamp; a folder (even one named `x.pdf`) is no PDF, so it reads as missing. */
  async stat(uri) {
    try {
      const { type, mtime, size } = await vscode.workspace.fs.stat(
        vscode.Uri.parse(uri),
      );
      const isFile =
        (type & vscode.FileType.File) !== 0 &&
        (type & vscode.FileType.Directory) === 0;
      return isFile ? { mtime, size } : undefined;
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
 * The host's PDFium, built beside the viewer: the engine bundle and the
 * viewer's embedpdf.wasm it loads, both from dist/pdf/ in the extension.
 * Read from `extensionPath` when asked, never earlier.
 */
export async function loadEngineBundle(
  extensionPath: string,
): Promise<{ bundle: typeof EngineModule; wasm: Uint8Array }> {
  const assets = path.join(extensionPath, "dist", "pdf");
  // A file URL, which `import` needs for an absolute path on Windows.
  const bundle = (await import(
    pathToFileURL(path.join(assets, "outline-engine.js")).href
  )) as typeof EngineModule;
  return {
    bundle,
    wasm: await readFile(path.join(assets, "webview", "embedpdf.wasm")),
  };
}

/**
 * The reader of PDF bookmarks that Lumiere offers to notes (`[[paper.pdf#`).
 * PDFium is the viewer's (see `loadEngineBundle`).
 */
export function createPdfOutlines(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): PdfOutlineReader {
  return new PdfOutlineReader({
    files: workspacePdfFiles,
    engine: async () => {
      const { bundle, wasm } = await loadEngineBundle(context.extensionPath);
      return bundle.createOutlineEngine(wasm);
    },
    log: (message) => log.warn(message),
  });
}

/** The paths of the workspace's folders on this machine's disk. */
export function localWorkspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
}
