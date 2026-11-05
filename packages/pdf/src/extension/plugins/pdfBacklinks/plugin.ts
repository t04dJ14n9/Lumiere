import * as vscode from "vscode";
import type { Context, Plugin } from "@workshop/core";
import { isTrustedBacklinkNoteUri } from "../../../shared/backlink-note-uri";
import {
  PdfBacklinkIndex,
  type PdfFile,
} from "../../../shared/pdf-backlink-index";
import { workspaceLocation } from "../pdf/files";
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

    wireOpenBacklinkNote(ctx, panels);
    const pushAll = wirePanelPush(ctx, panels, index);
    wireMarkdownListeners(ctx, index, () => cancelled, pushAll);
    void idleScan(index, () => cancelled, pushAll);
  },
};

function wireOpenBacklinkNote(ctx: Context, panels: PdfPanels): void {
  ctx.own(
    panels.handle("openBacklinkNote", async (_panel, message) => {
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(message.noteUri, true);
      } catch {
        return;
      }
      if (
        !isTrustedBacklinkNoteUri({
          noteUri: message.noteUri,
          scheme: uri.scheme,
          path: uri.path,
          inWorkspace: vscode.workspace.getWorkspaceFolder(uri) !== undefined,
        })
      ) {
        console.warn(`[pdfBacklinks] refused openBacklinkNote (${uri.scheme})`);
        return;
      }
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
}

function wirePanelPush(
  ctx: Context,
  panels: PdfPanels,
  index: PdfBacklinkIndex,
): () => void {
  // The vault-root file is looked up on disk, so a push finishes later. An
  // older push must not overwrite a newer one (a note saved meanwhile), nor
  // post to a viewer that has closed or after the plugin has stopped.
  const generations = new WeakMap<PdfPanel, number>();
  let stopped = false;
  ctx.own(
    {
      dispose: () => {
        stopped = true;
      },
    },
    "push lifetime",
  );
  const pushPanel = (panel: PdfPanel): void => {
    const generation = (generations.get(panel) ?? 0) + 1;
    generations.set(panel, generation);
    void index
      .hitsFor(workspaceLocation(panel.uri), isWorkspaceFile)
      .then((hits) => {
        const isCurrent =
          generations.get(panel) === generation &&
          !stopped &&
          panels.all.includes(panel);
        if (isCurrent) {
          panel.backlinks.set(hits);
        }
      });
  };
  const pushAll = (): void => {
    for (const panel of panels.all) {
      pushPanel(panel);
    }
  };
  for (const panel of panels.all) {
    pushPanel(panel);
  }
  ctx.own(panels.onDidOpen(pushPanel), "open listener");
  return pushAll;
}

/** Whether the folder holds a file at `path`; anything else (even an error) is no. */
async function isWorkspaceFile(file: PdfFile): Promise<boolean> {
  if (!file.folder) {
    return false;
  }
  try {
    const stat = await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(vscode.Uri.parse(file.folder), file.path),
    );
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

/** A note's links, under its workspace folder: see `workspaceLocation`. */
function indexNote(
  index: PdfBacklinkIndex,
  uri: vscode.Uri,
  text: string,
): void {
  const { folder, path } = workspaceLocation(uri);
  index.replaceNote(uri.toString(), path, text, folder);
}

function wireMarkdownListeners(
  ctx: Context,
  index: PdfBacklinkIndex,
  isCancelled: () => boolean,
  pushAll: () => void,
): void {
  ctx.own(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isCancelled() || !isMarkdownUri(document.uri)) {
        return;
      }
      indexNote(index, document.uri, document.getText());
      pushAll();
    }),
    "save listener",
  );

  const watcher = vscode.workspace.createFileSystemWatcher(MD_GLOB);
  ctx.own(watcher, "markdown watcher");
  const ingestUri = async (uri: vscode.Uri): Promise<void> => {
    if (isCancelled() || !isMarkdownUri(uri)) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder("utf8").decode(bytes);
      indexNote(index, uri, text);
      pushAll();
    } catch {
      // Unreadable notes are skipped; the index stays a best-effort cache.
    }
  };
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
      if (isCancelled() || !isMarkdownUri(uri)) {
        return;
      }
      index.removeNote(uri.toString());
      pushAll();
    }),
    "delete listener",
  );
}

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
          indexNote(index, uri, text);
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
