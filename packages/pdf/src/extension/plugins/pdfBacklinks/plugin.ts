import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { Context, Plugin } from "@workshop/core";
import { isTrustedBacklinkNoteUri } from "../../../shared/backlink-note-uri";
import {
  MARKDOWN_GLOB,
  isMarkdownPath,
  scanExclude,
} from "../../../shared/markdown-scan";
import { PdfBacklinkIndex } from "../../../shared/pdf-backlink-index";
import { isWorkspaceFile, workspaceLocation } from "../pdf/files";
import type { PdfPanel } from "../pdf/panel";
import type { PdfPanels } from "../pdf/panels";
import type {} from "../services";
import manifest from "./manifest";

const SCAN_CHUNK = 40;

/** Changes to notes that come together (a save, a checkout) make one push. */
const PUSH_DELAY_MS = 250;

/**
 * Derived vault index of Markdown → PDF deep links. From the first PDF
 * opened in the window (the extension also activates for Markdown alone,
 * whose readers need none of it), idle-scans every Markdown note, refreshes
 * on save/create/delete, and pushes per-PDF hits to open viewers. The index
 * is never written to disk.
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
    const pushSoon = debounced(ctx, pushAll, PUSH_DELAY_MS);
    startOnFirstPdf(ctx, panels, () => {
      if (cancelled) {
        return;
      }
      const indexed = wireMarkdownListeners(
        ctx,
        index,
        () => cancelled,
        pushSoon,
      );
      void idleScan(index, indexed, () => cancelled, pushSoon);
    });
  },
};

/** Run `start` once, when a PDF is open: now, or when the first one opens. */
function startOnFirstPdf(
  ctx: Context,
  panels: PdfPanels,
  start: () => void,
): void {
  if (panels.all.length > 0) {
    start();
    return;
  }
  let started = false;
  ctx.own(
    panels.onDidOpen(() => {
      if (!started) {
        started = true;
        start();
      }
    }),
    "first open listener",
  );
}

/** `run` after `delayMs` of quiet; never after the plugin stops. */
function debounced(ctx: Context, run: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.own({ dispose: () => clearTimeout(timer) }, "push timer");
  return () => {
    clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
}

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

/**
 * The notes as last indexed, by URI: a fingerprint of their folder and
 * text. A save is reported twice (the save itself, then the file watcher's
 * change), and only the first is indexed.
 */
type Indexed = Map<string, string>;

/**
 * Index a note's links, under its workspace folder (`workspaceLocation`).
 * Returns whether the open viewers need a push: the note's text changed and
 * it links, or linked, to a PDF.
 */
function indexNote(
  index: PdfBacklinkIndex,
  indexed: Indexed,
  uri: vscode.Uri,
  text: string,
): boolean {
  const { folder, path } = workspaceLocation(uri);
  const key = uri.toString();
  const fingerprint = `${folder}\u0000${createHash("sha256").update(text).digest("base64")}`;
  if (indexed.get(key) === fingerprint) {
    return false;
  }
  indexed.set(key, fingerprint);
  const linked = index.hasLinks(key);
  index.replaceNote(key, path, text, folder);
  return linked || index.hasLinks(key);
}

function wireMarkdownListeners(
  ctx: Context,
  index: PdfBacklinkIndex,
  isCancelled: () => boolean,
  push: () => void,
): Indexed {
  const indexed: Indexed = new Map();
  ctx.own({ dispose: () => indexed.clear() }, "indexed notes");
  ctx.own(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isCancelled() || !isMarkdownUri(document.uri)) {
        return;
      }
      if (indexNote(index, indexed, document.uri, document.getText())) {
        push();
      }
    }),
    "save listener",
  );

  const watcher = vscode.workspace.createFileSystemWatcher(MARKDOWN_GLOB);
  ctx.own(watcher, "markdown watcher");
  const ingestUri = async (uri: vscode.Uri): Promise<void> => {
    if (isCancelled() || !isMarkdownUri(uri)) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder("utf8").decode(bytes);
      if (indexNote(index, indexed, uri, text)) {
        push();
      }
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
      const key = uri.toString();
      indexed.delete(key);
      if (index.hasLinks(key)) {
        index.removeNote(key);
        push();
      }
    }),
    "delete listener",
  );
  return indexed;
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return isMarkdownPath(uri.path);
}

/**
 * The notes of every workspace folder, one search per folder because
 * `files.exclude` is set per folder (see `scanExclude`).
 */
async function findNotes(): Promise<vscode.Uri[]> {
  const found = await Promise.all(
    (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, MARKDOWN_GLOB),
        scanExclude(
          vscode.workspace.getConfiguration("files", folder.uri).get("exclude"),
        ),
      ),
    ),
  );
  return found.flat();
}

/** Scan vault Markdown in chunks so activation stays responsive. */
async function idleScan(
  index: PdfBacklinkIndex,
  indexed: Indexed,
  isCancelled: () => boolean,
  onProgress: () => void,
): Promise<void> {
  let files: vscode.Uri[];
  try {
    files = await findNotes();
  } catch {
    return;
  }
  // A chunk with no links to any PDF changes no viewer.
  let linked = false;
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
          if (indexNote(index, indexed, uri, text)) {
            linked = true;
          }
        } catch {
          // skip unreadable
        }
      }),
    );
    if (linked) {
      onProgress();
    }
    linked = false;
    await yieldIdle();
  }
}

function yieldIdle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
