import * as vscode from "vscode";
import type { Plugin } from "@workshop/core";
import { PdfBacklinkIndex } from "../../../shared/pdf-backlink-index";
import { displayPath } from "../pdf/files";
import type { PdfPanel } from "../pdf/panel";
import type { PdfPanels } from "../pdf/panels";
import type {} from "../services";
import manifest from "./manifest";

const MD_GLOB = "**/*.md";
const MD_EXCLUDE = "{**/node_modules/**,**/.git/**}";
const SCAN_CHUNK = 40;

/**
 * Derived vault index of Markdown → PDF deep links. Idle-scans every
 * Markdown note, refreshes on save/create/delete, and pushes per-PDF hits
 * to open viewers. The index is never written to disk.
 */
export const pdfBacklinksPlugin: Plugin = {
  name: manifest.id,
  inject: { required: ["pdfPanels"] },
  provides: ["pdfBacklinkIndex"],
  apply(ctx) {
    const panels = ctx.pdfPanels;
    const index = new PdfBacklinkIndex();
    ctx.provide("pdfBacklinkIndex", index);

    ctx.own(
      panels.handle("openBacklinkNote", async (_panel, message) => {
        const uri = vscode.Uri.parse(message.noteUri);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        const position = document.positionAt(message.linkOffset);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
      }),
      "open backlink note",
    );

    let cancelled = false;
    ctx.own(
      {
        dispose: () => {
          cancelled = true;
          index.clear();
        },
      },
      "index lifetime",
    );

    const pushPanel = (panel: PdfPanel): void => {
      const key = displayPath(panel.uri);
      panel.setPdfBacklinks([...index.lookup(key)]);
    };
    const pushAll = (): void => {
      for (const panel of panels.all) {
        pushPanel(panel);
      }
    };

    const ingestUri = async (uri: vscode.Uri): Promise<void> => {
      if (cancelled || !isMarkdownUri(uri)) {
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder("utf8").decode(bytes);
        index.replaceNote(uri.toString(), displayPath(uri), text);
        pushAll();
      } catch {
        // Unreadable notes are skipped; the index stays a best-effort cache.
      }
    };

    for (const panel of panels.all) {
      pushPanel(panel);
    }
    ctx.own(panels.onDidOpen(pushPanel), "open listener");

    ctx.own(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (cancelled || !isMarkdownUri(document.uri)) {
          return;
        }
        index.replaceNote(
          document.uri.toString(),
          displayPath(document.uri),
          document.getText(),
        );
        pushAll();
      }),
      "save listener",
    );

    const watcher = vscode.workspace.createFileSystemWatcher(MD_GLOB);
    ctx.own(watcher, "markdown watcher");
    ctx.own(
      watcher.onDidCreate((uri) => void ingestUri(uri)),
      "create listener",
    );
    ctx.own(
      watcher.onDidChange((uri) => void ingestUri(uri)),
      "change listener",
    );
    ctx.own(
      watcher.onDidDelete((uri) => {
        if (cancelled || !isMarkdownUri(uri)) {
          return;
        }
        index.removeNote(uri.toString());
        pushAll();
      }),
      "delete listener",
    );

    void idleScan(index, () => cancelled, pushAll);
  },
};

function isMarkdownUri(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith(".md");
}

/** Scan vault Markdown in chunks so activation stays responsive. */
async function idleScan(
  index: PdfBacklinkIndex,
  isCancelled: () => boolean,
  onProgress: () => void,
): Promise<void> {
  let files: vscode.Uri[];
  try {
    files = await vscode.workspace.findFiles(MD_GLOB, MD_EXCLUDE);
  } catch {
    return;
  }
  for (let i = 0; i < files.length; i += SCAN_CHUNK) {
    if (isCancelled()) {
      return;
    }
    const chunk = files.slice(i, i + SCAN_CHUNK);
    await Promise.all(
      chunk.map(async (uri) => {
        if (isCancelled() || !isMarkdownUri(uri)) {
          return;
        }
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = new TextDecoder("utf8").decode(bytes);
          index.replaceNote(uri.toString(), displayPath(uri), text);
        } catch {
          // skip unreadable
        }
      }),
    );
    onProgress();
    await yieldIdle();
  }
}

function yieldIdle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
