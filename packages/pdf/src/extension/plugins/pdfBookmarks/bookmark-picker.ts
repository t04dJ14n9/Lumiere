import * as vscode from "vscode";
import type { Bookmark } from "../../../shared/bookmarks";

/** Item buttons, as VS Code's own Quick Picks have them (Open Recent's remove, for one). */
const RENAME_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("edit"),
  tooltip: "Rename Bookmark",
};
const DELETE_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("trash"),
  tooltip: "Delete Bookmark",
};

export interface BookmarkPickItem extends vscode.QuickPickItem {
  bookmark: Bookmark;
}

/**
 * One row per bookmark: its title, then its page and the outline section it
 * is in. A title that is already the section's name is not said twice.
 */
export function bookmarkPickItems(
  bookmarks: readonly Bookmark[],
  sectionOf: (bookmark: Bookmark) => string | undefined,
): BookmarkPickItem[] {
  return bookmarks.map((bookmark) => {
    const section = sectionOf(bookmark)?.trim();
    const page = `Page ${bookmark.page}`;
    return {
      // `$(name)` in a label or a description is an icon: a title, and the
      // outline's section name, are text.
      label: asText(bookmark.title),
      description:
        section && section !== bookmark.title
          ? `${page} · ${asText(section)}`
          : page,
      buttons: [RENAME_BUTTON, DELETE_BUTTON],
      bookmark,
    };
  });
}

function asText(text: string): string {
  return text.replaceAll("$(", "\\$(");
}

/** What the picker needs from the PDF whose bookmarks it lists. */
export interface BookmarkPickerSource {
  /** The bookmarks now, in order; rejects when the file cannot be read. */
  load(): Promise<readonly Bookmark[]>;
  /** The outline section a bookmark falls in, to show beside it. */
  sectionOf(bookmark: Bookmark): string | undefined;
  /** Delete a bookmark, and say so itself if it cannot: never rejects. */
  remove(bookmark: Bookmark): Promise<void>;
  /** The bookmarks or the outline changed, or the reader left the PDF. */
  onDidChange(listener: () => void): vscode.Disposable;
  /** False once the reader has left the PDF: the picker closes. */
  isCurrent(): boolean;
}

export interface BookmarkChoice {
  action: "go" | "rename";
  bookmark: Bookmark;
}

/**
 * Go to Bookmark's Quick Pick: Enter on a row chooses it to go to, the edit
 * button chooses it to rename (the caller asks for the title, which takes
 * this Quick Pick's place, and shows it again), and the trash button deletes
 * it at once, leaving the Quick Pick open on the rest. Resolves with nothing
 * on Escape.
 */
export function pickBookmark(
  source: BookmarkPickerSource,
): Promise<BookmarkChoice | undefined> {
  const picker = vscode.window.createQuickPick<BookmarkPickItem>();
  picker.title = "Go to Bookmark";
  picker.matchOnDescription = true;
  picker.busy = true;
  return new Promise((resolve) => {
    let open = true;
    // The latest read fills the rows: a slow one must not undo a newer one.
    let generation = 0;
    const finish = (choice?: BookmarkChoice): void => {
      resolve(choice);
      picker.hide();
    };
    const refresh = async (): Promise<void> => {
      if (!source.isCurrent()) {
        picker.hide();
        return;
      }
      const mine = ++generation;
      const shown = await showBookmarks(picker, source);
      if (open && mine === generation) {
        shown();
      }
    };
    const listening = vscode.Disposable.from(
      picker.onDidAccept(() => {
        const item = picker.selectedItems[0];
        finish(item && { action: "go", bookmark: item.bookmark });
      }),
      picker.onDidTriggerItemButton(({ item, button }) => {
        if (button === RENAME_BUTTON) {
          finish({ action: "rename", bookmark: item.bookmark });
        } else if (button === DELETE_BUTTON) {
          void source.remove(item.bookmark);
        }
      }),
      source.onDidChange(() => void refresh()),
      picker.onDidHide(() => {
        open = false;
        resolve(undefined);
        listening.dispose();
        picker.dispose();
      }),
    );
    picker.show();
    void refresh();
  });
}

/** Read the bookmarks; the returned function puts them (or why not) on the picker. */
async function showBookmarks(
  picker: vscode.QuickPick<BookmarkPickItem>,
  source: BookmarkPickerSource,
): Promise<() => void> {
  try {
    const bookmarks = await source.load();
    return () => {
      picker.items = bookmarkPickItems(bookmarks, (bookmark) =>
        source.sectionOf(bookmark),
      );
      picker.placeholder = bookmarks.length
        ? "Select a bookmark"
        : "No bookmarks in this PDF yet.";
      picker.busy = false;
    };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return () => {
      picker.items = [];
      picker.placeholder = `Could not read the bookmarks. ${why}`;
      picker.busy = false;
    };
  }
}
