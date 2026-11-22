import type { Bookmark } from "../../shared/bookmarks";
import type { HostMessage } from "../../shared/messages";

/**
 * Holds the PDF's bookmarks for one panel and (re)posts them to its viewer,
 * for the side panel's Bookmarks tab. The extension reads them
 * (`pdfBookmarks`); the rebuilt page of a viewer starts with none.
 */
export class BookmarkOutlet {
  private shown: { items: Bookmark[]; problem?: string } | undefined;

  constructor(private readonly post: (message: HostMessage) => void) {}

  /** The bookmarks as they are now; `problem` says why the file could not be read. */
  set(items: readonly Bookmark[], problem?: string): void {
    this.shown = { items: [...items], ...(problem ? { problem } : {}) };
    this.send();
  }

  /** Send them again after a load. */
  rehydrate(): void {
    if (this.shown) {
      this.send();
    }
  }

  private send(): void {
    if (this.shown) {
      this.post({ type: "bookmarks", ...this.shown });
    }
  }
}
