import * as vscode from "vscode";
import {
  bookmarkFileOf,
  type BookmarkFileRef,
  type BookmarkStore,
} from "../../../host/viewer/bookmark-store";
import type { Bookmark } from "../../../shared/bookmarks";
import { BOOKMARK_COMMAND_IDS } from "../../../shared/command-ids";
import type { PdfPanels } from "../pdf/panels";

/** Where the view is contributed (`contributes.json`): the Explorer, beside PDF Outline. */
export const BOOKMARKS_VIEW_ID = "lumiere.pdf.bookmarks";

/** What the row menus (`view/item/context`) match a bookmark row by. */
export const BOOKMARK_ITEM_CONTEXT = "lumiere.pdf.bookmark";

/**
 * PDF Bookmarks in the Explorer: the reader's own bookmarks of the active
 * PDF, in page order. Like PDF Outline it shows only while a PDF is active
 * (its `when` in `contributes.json`). A click goes to the bookmark; the rows
 * and the view title have Rename, Delete and Add Bookmark.
 */
export function registerBookmarksView(
  panels: Pick<PdfPanels, "active" | "onDidChange">,
  store: BookmarkStore,
  log: Pick<vscode.LogOutputChannel, "warn">,
): vscode.Disposable {
  const provider = new BookmarkProvider(panels, store, log, (message) => {
    view.message = message;
  });
  const view = vscode.window.createTreeView(BOOKMARKS_VIEW_ID, {
    treeDataProvider: provider,
  });
  provider.start();
  return vscode.Disposable.from(provider, view);
}

class BookmarkProvider
  implements vscode.TreeDataProvider<Bookmark>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: Bookmark[] = [];
  /** The PDF whose file the rows come from, and the stop for its watcher. */
  private shown:
    { file: BookmarkFileRef; key: string; stop: () => void } | undefined;
  /** Advanced by every read: only the latest may fill the rows. */
  private generation = 0;
  private readonly subscriptions: { dispose(): void }[] = [];

  constructor(
    private readonly panels: Pick<PdfPanels, "active" | "onDidChange">,
    private readonly store: BookmarkStore,
    private readonly log: Pick<vscode.LogOutputChannel, "warn">,
    /** The text the view shows above its rows (why they are missing, if they are); empty for none. */
    private readonly say: (message: string) => void,
  ) {}

  start(): void {
    this.subscriptions.push(
      // Page and zoom reports come about every 100 ms while scrolling: only a
      // change of the PDF (or of its bytes) reads a file.
      this.panels.onDidChange(() => this.follow()),
      this.store.onDidChange((key) => {
        if (key === this.shown?.key) {
          void this.reload();
        }
      }),
    );
    this.follow();
  }

  getChildren(): Bookmark[] {
    return this.rows;
  }

  getTreeItem(bookmark: Bookmark): vscode.TreeItem {
    const row = new vscode.TreeItem(
      bookmark.title,
      vscode.TreeItemCollapsibleState.None,
    );
    // The id keeps the selection on a row when the rows change around it.
    row.id = bookmark.id;
    row.description = `Page ${bookmark.page}`;
    row.tooltip = `${bookmark.title} — page ${bookmark.page}`;
    row.iconPath = new vscode.ThemeIcon("bookmark");
    row.contextValue = BOOKMARK_ITEM_CONTEXT;
    row.command = {
      command: BOOKMARK_COMMAND_IDS.goToBookmark,
      title: "Go to Bookmark",
      arguments: [bookmark],
    };
    return row;
  }

  dispose(): void {
    this.generation++;
    this.shown?.stop();
    this.shown = undefined;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changed.dispose();
  }

  /** Show the bookmarks of the PDF in the active editor, watching its file. */
  private follow(): void {
    const file = bookmarkFileOf(this.panels.active);
    const key = file && this.store.key(file);
    if (key === this.shown?.key) {
      return;
    }
    this.shown?.stop();
    this.shown =
      file && key ? { file, key, stop: this.store.watch(file) } : undefined;
    void this.reload();
  }

  /** Never rejects: a file that cannot be read is said in the view. */
  private async reload(): Promise<void> {
    const generation = ++this.generation;
    const file = this.shown?.file;
    let rows: readonly Bookmark[] = [];
    let problem: string | undefined;
    if (file) {
      try {
        rows = await this.store.read(file);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        this.log.warn(`Could not read the bookmarks: ${problem}`);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.rows = [...rows];
    this.say(problem ?? "");
    this.changed.fire();
  }
}
