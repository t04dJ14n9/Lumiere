import type { Plugin } from "@workshop/core";
import { BookmarkStore } from "../../../host/viewer/bookmark-store";
import type { PdfPanel } from "../pdf/panel";
import type {} from "../services";
import { vscodePdfFiles } from "../pdf/files";
import {
  addBookmarkTo,
  deleteBookmarkIn,
  registerBookmarkCommands,
  renameBookmarkIn,
} from "./bookmark-commands";
import { registerBookmarksView } from "./bookmark-view";
import { feedPanelBookmarks } from "./panel-feed";
import manifest from "./manifest";

/** A row of the side panel's Bookmarks tab: rename or delete. */
function changeBookmark(
  store: BookmarkStore,
  panel: PdfPanel,
  message: { action: "rename" | "delete"; id: string },
): Promise<void> {
  return message.action === "rename"
    ? renameBookmarkIn(store, panel, message.id)
    : deleteBookmarkIn(store, panel, message.id);
}

/**
 * The reader's own bookmarks of a PDF: Add Bookmark, Go to Bookmark…, and the
 * PDF Bookmarks view in the Explorer. They are kept beside the annotation file
 * (`bookmark-store`), so the PDF never changes, even in a protected folder.
 */
export const pdfBookmarksPlugin: Plugin = {
  name: manifest.id,
  inject: { required: ["pdfPanels", "outputChannel"] },
  apply(ctx) {
    const { outputChannel } = ctx;
    const store = ctx.own(
      new BookmarkStore(vscodePdfFiles.bookmarks, (message) =>
        outputChannel.warn(message),
      ),
      "bookmark store",
    );
    const parts = { panels: ctx.pdfPanels, store };
    ctx.own(registerBookmarkCommands(parts), "commands");
    ctx.own(
      registerBookmarksView(ctx.pdfPanels, store, outputChannel),
      "treeView",
    );
    // The viewer's side panel lists them, and adds, renames and deletes them
    // through the same store, in its own editor.
    ctx.own(feedPanelBookmarks(ctx.pdfPanels, store, outputChannel), "feed");
    ctx.own(
      ctx.pdfPanels.handle("bookmarkAction", (panel, message) =>
        message.action === "add"
          ? addBookmarkTo(store, panel)
          : changeBookmark(store, panel, message),
      ),
      "side panel actions",
    );
  },
};
