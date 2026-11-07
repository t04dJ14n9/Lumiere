import * as vscode from "vscode";
import {
  highlightFragment,
  parseSidecar,
  sidecarBelongsTo,
  type SidecarHighlight,
} from "../../../shared/sidecar-format";
import type { SidecarWrite } from "../../../shared/sidecar-messages";
import type { PdfPanel } from "../pdf/panel";
import { readSidecar } from "./document";
import { locateSidecar, type SidecarFile } from "./location";

/** What one PDF editor shows from its sidecar. */
interface PanelSidecar {
  file: SidecarFile;
  highlights: SidecarHighlight[];
  /** Settles once the sidecar has been read for the first time. */
  loaded: Promise<void>;
  watcher: vscode.Disposable;
}

/**
 * Legacy sidecar highlights of every open PDF editor: read when it opens and
 * whenever the file changes, and opened from `#hl-…` links. All `sidecarWrite`
 * ops (upsert and delete) are ignored — vault Markdown is the highlight store
 * and the webview is untrusted. Existing `*.pdf.lumiere.md` files are never
 * auto-deleted.
 */
export class Sidecars implements vscode.Disposable {
  private readonly panels = new Map<PdfPanel, PanelSidecar>();
  /** Editors whose sidecar is still being located: one search each. */
  private readonly attaching = new Map<PdfPanel, Promise<PanelSidecar>>();
  private readonly warned = new Set<string>();

  /** Start keeping `panel`'s sidecar, until its editor closes. */
  open(panel: PdfPanel): void {
    // Claim ownership before locate/read await: null means "no sidecar" and the
    // highlight tool falls through to markPdf(); [] means owned/pending.
    panel.setSidecar([]);
    void this.track(panel);
  }

  close(panel: PdfPanel): void {
    this.panels.get(panel)?.watcher.dispose();
    this.panels.delete(panel);
    this.attaching.delete(panel);
  }

  /** The settings changed: find every sidecar again. */
  relocateAll(): void {
    for (const panel of this.trackedPanels()) {
      this.close(panel);
      this.open(panel);
    }
  }

  /**
   * Ignore every write from the untrusted viewer (upsert and delete). Legacy
   * sidecars stay readable for `#hl-…` only; vault Markdown is the store.
   */
  write(_panel: PdfPanel, _message: SidecarWrite): Promise<void> {
    return Promise.resolve();
  }

  /** Show highlight `id` (a `#hl-…` fragment) in `panel`, and flash it. */
  async reveal(panel: PdfPanel, id: string): Promise<void> {
    const state =
      this.panels.get(panel) ??
      (await (this.attaching.get(panel) ?? this.track(panel)));
    await state.loaded;
    const found = state.highlights.find(
      (highlight) => highlightFragment(highlight.id) === id,
    );
    if (!found) {
      void vscode.window.showWarningMessage(
        `No highlight ${id} in ${basename(state.file.uri)}.`,
      );
      return;
    }
    panel.goTo({ page: found.page, viewRect: boundsOf(found) });
  }

  dispose(): void {
    for (const state of this.panels.values()) {
      state.watcher.dispose();
    }
    for (const panel of this.trackedPanels()) {
      panel.setSidecar(null);
    }
    this.panels.clear();
    this.attaching.clear();
  }

  private trackedPanels(): Set<PdfPanel> {
    return new Set([...this.panels.keys(), ...this.attaching.keys()]);
  }

  private track(panel: PdfPanel): Promise<PanelSidecar> {
    const pending: Promise<PanelSidecar> = this.attach(
      panel,
      (): boolean => this.attaching.get(panel) === pending,
    ).finally(() => {
      if (this.attaching.get(panel) === pending) {
        this.attaching.delete(panel);
      }
    });
    this.attaching.set(panel, pending);
    return pending;
  }

  private async attach(
    panel: PdfPanel,
    isCurrent: () => boolean,
  ): Promise<PanelSidecar> {
    const file = await locateSidecar(panel.uri, (message) =>
      this.warn(message),
    );
    let done = (): void => undefined;
    // The editor closed or relocated while its sidecar was being found: keep nothing.
    const closed = !isCurrent();
    const state: PanelSidecar = {
      file,
      highlights: [],
      loaded: new Promise((resolve) => (done = resolve)),
      watcher: closed
        ? { dispose: () => undefined }
        : this.watch(panel, file.uri),
    };
    if (closed) {
      done();
      return state;
    }
    this.panels.get(panel)?.watcher.dispose();
    this.panels.set(panel, state);
    await this.reload(panel).finally(done);
    return state;
  }

  private watch(panel: PdfPanel, uri: vscode.Uri): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), basename(uri)),
    );
    const reload = (): void => void this.reload(panel);
    return vscode.Disposable.from(
      watcher,
      watcher.onDidCreate(reload),
      watcher.onDidChange(reload),
      watcher.onDidDelete(reload),
    );
  }

  /** Read the sidecar again and show its highlights. */
  private async reload(panel: PdfPanel): Promise<void> {
    const state = this.panels.get(panel);
    if (!state) {
      return;
    }
    let text: string | undefined;
    try {
      text = await readSidecar(state.file.uri);
    } catch (error) {
      this.warn(`Could not read ${state.file.uri.fsPath}: ${String(error)}`);
    }
    const file = parseSidecar(text ?? "");
    // Another PDF's sidecar (two PDFs of one name in a sidecar folder) is not shown.
    state.highlights = sidecarBelongsTo(file, state.file.owner)
      ? file.highlights
      : [];
    if (this.panels.get(panel) === state) {
      panel.setSidecar(state.highlights);
    }
  }

  /** Say a problem once per session, not on every editor. */
  private warn(message: string): void {
    if (!this.warned.has(message)) {
      this.warned.add(message);
      void vscode.window.showWarningMessage(message);
    }
  }
}

/** The box around a highlight's lines, which the viewer scrolls to and flashes. */
function boundsOf(highlight: SidecarHighlight): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const lefts = highlight.segmentRects.map((rect) => rect.x);
  const tops = highlight.segmentRects.map((rect) => rect.y);
  const rights = highlight.segmentRects.map((rect) => rect.x + rect.w);
  const bottoms = highlight.segmentRects.map((rect) => rect.y + rect.h);
  const left = Math.max(0, Math.min(...lefts));
  const top = Math.max(0, Math.min(...tops));
  return {
    left,
    top,
    width: Math.max(...rights) - left,
    height: Math.max(...bottoms) - top,
  };
}

function basename(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}
