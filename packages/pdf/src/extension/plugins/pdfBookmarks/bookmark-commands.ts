import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  bookmarkFileOf,
  type BookmarkFileRef,
  type BookmarkStore,
} from "../../../host/viewer/bookmark-store";
import {
  defaultBookmarkTitle,
  parseBookmark,
  validateBookmarkTitle,
  type Bookmark,
} from "../../../shared/bookmarks";
import { BOOKMARK_COMMAND_IDS } from "../../../shared/command-ids";
import { findActiveOutlineItem } from "../../../shared/outline";
import { positionFromView } from "../../../shared/reading-position";
import type { PdfPanel } from "../pdf/panel";
import type { PdfPanels } from "../pdf/panels";
import { pickBookmark, type BookmarkPickerSource } from "./bookmark-picker";

export interface BookmarkParts {
  panels: Pick<PdfPanels, "active" | "onDidChange">;
  store: BookmarkStore;
}

/**
 * Add Bookmark, Go to Bookmark, Rename Bookmark and Delete Bookmark, for the
 * PDF in the active editor. Rename and Delete are for the rows of the PDF
 * Bookmarks view (they take the row's bookmark) and are hidden from the
 * palette; Go to Bookmark's Quick Pick has them as item buttons.
 */
export function registerBookmarkCommands(
  parts: BookmarkParts,
): vscode.Disposable {
  const ids = BOOKMARK_COMMAND_IDS;
  return vscode.Disposable.from(
    vscode.commands.registerCommand(ids.addBookmark, () => addBookmark(parts)),
    vscode.commands.registerCommand(ids.goToBookmark, (bookmark?: unknown) =>
      goToBookmark(parts, bookmark),
    ),
    vscode.commands.registerCommand(ids.renameBookmark, (bookmark?: unknown) =>
      renameBookmark(parts, bookmark),
    ),
    vscode.commands.registerCommand(ids.deleteBookmark, (bookmark?: unknown) =>
      deleteBookmark(parts, bookmark),
    ),
  );
}

/** Save the place the reader is at, under a title they can change. */
async function addBookmark({ panels, store }: BookmarkParts): Promise<void> {
  const panel = panels.active;
  if (!panel) {
    return;
  }
  const position = await readingPlace(panel);
  const file = bookmarkFileOf(panel);
  if (!position || !file) {
    tellStillOpening();
    return;
  }
  // Escape cancels; Enter keeps the title offered.
  const title = await vscode.window.showInputBox({
    title: "Add Bookmark",
    prompt: `Title for the bookmark on page ${position.page}`,
    value: defaultBookmarkTitle(panel.outline, position),
    validateInput: validateBookmarkTitle,
  });
  if (title === undefined) {
    return;
  }
  const bookmark: Bookmark = {
    id: randomUUID(),
    title: title.trim(),
    page: position.page,
    position: { top: position.top, left: position.left },
    created: new Date().toISOString(),
  };
  if (await attempt("add the bookmark", () => store.add(file, bookmark))) {
    vscode.window.setStatusBarMessage(
      `$(bookmark) Added bookmark "${bookmark.title}"`,
      4000,
    );
  }
}

/**
 * The page and the point on it the reader is at: what the viewer says now
 * (which first settles a jump still moving), else its last report. Missing
 * while the viewer is still opening the PDF.
 */
async function readingPlace(
  panel: PdfPanel,
): Promise<{ page: number; top: number; left: number } | undefined> {
  const captured = await panel.capturePosition();
  const position =
    captured?.position ?? (panel.view && positionFromView(panel.view));
  return (
    position && {
      page: position.page,
      top: position.top,
      left: position.left,
    }
  );
}

function tellStillOpening(): void {
  void vscode.window.showInformationMessage(
    "The PDF is still opening. Add the bookmark once it has appeared.",
  );
}

/**
 * With a bookmark (a click on a row of the view) go to it; without one, ask
 * with a Quick Pick. Both are deliberate jumps, like the outline's.
 */
async function goToBookmark(
  parts: BookmarkParts,
  argument: unknown,
): Promise<void> {
  const panel = parts.panels.active;
  if (!panel) {
    return;
  }
  const clicked = parseBookmark(argument);
  if (clicked) {
    jumpTo(panel, clicked);
    return;
  }
  const file = bookmarkFileOf(panel);
  if (!file) {
    tellStillOpening();
    return;
  }
  for (;;) {
    const choice = await pickBookmark(pickerSource(parts, panel, file));
    if (parts.panels.active !== panel || !choice) {
      return;
    }
    if (choice.action === "go") {
      jumpTo(panel, choice.bookmark);
      return;
    }
    // The title is asked for in the Quick Pick's place; the list comes back.
    await rename(parts.store, file, choice.bookmark);
  }
}

function jumpTo(panel: PdfPanel, bookmark: Bookmark): void {
  panel.goTo(
    { page: bookmark.page },
    bookmark.position.top,
    bookmark.position.left,
  );
}

function pickerSource(
  { panels, store }: BookmarkParts,
  panel: PdfPanel,
  file: BookmarkFileRef,
): BookmarkPickerSource {
  const key = store.key(file);
  return {
    load: () => store.read(file),
    sectionOf: (bookmark) =>
      findActiveOutlineItem(panel.outline ?? [], {
        page: bookmark.page,
        top: bookmark.position.top,
      })?.title,
    remove: async (bookmark) => {
      await attempt("delete the bookmark", () =>
        store.remove(file, bookmark.id),
      );
    },
    isCurrent: () => panels.active === panel,
    onDidChange: (listener) => {
      // Another window's saves arrive through the file's watcher.
      const stopWatching = store.watch(file);
      let outline = panel.outline;
      return vscode.Disposable.from(
        { dispose: stopWatching },
        store.onDidChange((changed) => {
          if (changed === key) {
            listener();
          }
        }),
        panels.onDidChange(() => {
          // Not every page report: leaving the PDF, or the outline arriving.
          if (panels.active !== panel || panel.outline !== outline) {
            outline = panel.outline;
            listener();
          }
        }),
      );
    },
  };
}

async function renameBookmark(
  { panels, store }: BookmarkParts,
  argument: unknown,
): Promise<void> {
  const bookmark = parseBookmark(argument);
  const file = bookmarkFileOf(panels.active);
  if (bookmark && file) {
    await rename(store, file, bookmark);
  }
}

async function rename(
  store: BookmarkStore,
  file: BookmarkFileRef,
  bookmark: Bookmark,
): Promise<void> {
  const title = await vscode.window.showInputBox({
    title: "Rename Bookmark",
    value: bookmark.title,
    validateInput: validateBookmarkTitle,
  });
  if (title === undefined || title.trim() === bookmark.title) {
    return;
  }
  await attempt("rename the bookmark", () =>
    store.rename(file, bookmark.id, title),
  );
}

async function deleteBookmark(
  { panels, store }: BookmarkParts,
  argument: unknown,
): Promise<void> {
  const bookmark = parseBookmark(argument);
  const file = bookmarkFileOf(panels.active);
  if (bookmark && file) {
    await attempt("delete the bookmark", () => store.remove(file, bookmark.id));
  }
}

/** Run a change to a bookmark file; a failure is said to the reader, not thrown. */
async function attempt(
  what: string,
  change: () => Promise<void>,
): Promise<boolean> {
  try {
    await change();
    return true;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not ${what}. ${why}`);
    return false;
  }
}
