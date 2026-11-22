import * as vscode from "vscode";
import {
  bookmarkFileOf,
  type BookmarkFileRef,
  type BookmarkStore,
} from "../../../host/viewer/bookmark-store";
import type { PdfPanel } from "../pdf/panel";
import type { PdfPanels } from "../pdf/panels";

/**
 * Sends the PDF's bookmarks to the side panel of every PDF editor, and again
 * whenever the file changes (a save here, or another window's). The Explorer's
 * PDF Bookmarks view follows the active editor; the side panel belongs to its
 * own editor, which in a floating window is not always the active one.
 */
export function feedPanelBookmarks(
  panels: Pick<PdfPanels, "all" | "onDidOpen">,
  store: BookmarkStore,
  log: Pick<vscode.LogOutputChannel, "warn">,
): vscode.Disposable {
  const feeds = new Set<PanelFeed>();
  const start = (panel: PdfPanel): void => {
    const feed = new PanelFeed(panel, store, log);
    feeds.add(feed);
    panel.webviewPanel.onDidDispose(() => {
      feed.dispose();
      feeds.delete(feed);
    });
  };
  panels.all.forEach(start);
  const opened = panels.onDidOpen(start);
  return new vscode.Disposable(() => {
    opened.dispose();
    for (const feed of feeds) {
      feed.dispose();
    }
    feeds.clear();
  });
}

/** One editor's feed: follows the bookmark file of the bytes its viewer has. */
class PanelFeed {
  private shown:
    { file: BookmarkFileRef; key: string; stop: () => void } | undefined;
  /** Advanced by every read: only the latest may post. */
  private generation = 0;
  private disposed = false;
  private readonly subscriptions: { dispose(): void }[];

  constructor(
    private readonly panel: PdfPanel,
    private readonly store: BookmarkStore,
    private readonly log: Pick<vscode.LogOutputChannel, "warn">,
  ) {
    this.subscriptions = [
      // Page reports come every 100 ms while scrolling: only a different
      // file (other bytes) is read.
      panel.onDidChange(() => this.follow()),
      store.onDidChange((key) => {
        if (key === this.shown?.key) {
          void this.reload();
        }
      }),
    ];
    this.follow();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.shown?.stop();
    this.shown = undefined;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private follow(): void {
    const file = bookmarkFileOf(this.panel);
    const key = file && this.store.key(file);
    if (this.disposed || key === this.shown?.key) {
      return;
    }
    this.shown?.stop();
    this.shown =
      file && key ? { file, key, stop: this.store.watch(file) } : undefined;
    void this.reload();
  }

  /** Never rejects: a file that cannot be read is said in the tab. */
  private async reload(): Promise<void> {
    const generation = ++this.generation;
    const file = this.shown?.file;
    if (!file) {
      return;
    }
    let items: Awaited<ReturnType<BookmarkStore["read"]>> = [];
    let problem: string | undefined;
    try {
      items = await this.store.read(file);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      this.log.warn(`Could not read the bookmarks: ${problem}`);
    }
    if (generation === this.generation && !this.disposed) {
      this.panel.bookmarks.set(items, problem);
    }
  }
}
