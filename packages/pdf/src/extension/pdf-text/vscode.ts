import type * as vscode from "vscode";
import { loadEngineBundle, workspacePdfFiles } from "../outlines/vscode";
import { PdfTextReader } from "./reader";

/**
 * The reader of PDF text for the agent bridge's tools. Like the outline
 * reader it reads the workspace's PDFs only, and starts PDFium on the first
 * request.
 */
export function createPdfTextReader(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): PdfTextReader {
  return new PdfTextReader({
    files: workspacePdfFiles,
    engine: async () => {
      const { bundle, wasm } = await loadEngineBundle(context.extensionPath);
      return bundle.createPdfTextEngine(wasm);
    },
    log: (message) => log.warn(message),
  });
}
