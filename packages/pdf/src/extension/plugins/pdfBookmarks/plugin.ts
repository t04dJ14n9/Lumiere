import type { Plugin } from "@workshop/core";
import { BookmarkStore } from "../../../host/viewer/bookmark-store";
import type {} from "../services";
import { vscodePdfFiles } from "../pdf/files";
import { registerBookmarkCommands } from "./bookmark-commands";
import { registerBookmarksView } from "./bookmark-view";
import manifest from "./manifest";

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
  },
};
