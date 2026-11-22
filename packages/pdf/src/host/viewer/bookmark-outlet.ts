import type { Bookmark } from "../../shared/bookmarks";
import type { HostMessage } from "../../shared/messages";
import { Emitter } from "../events";

/**
 * Holds the PDF's bookmarks for one panel and (re)posts them to its viewer,
 * for the side panel's Bookmarks tab. The extension reads them
 * (`pdfBookmarks`); the rebuilt page of a viewer starts with none.
 *
 * The list is of one file, named by the hash of its bytes. A viewer that is
 * given other bytes (the PDF was replaced on disk, even by one that will not
 * open) is not told the old list again: whoever reads it is told to read for
 * the new bytes (`onStale`).
 */
export class BookmarkOutlet {
  private shown:
    { items: Bookmark[]; sha256: string; problem?: string } | undefined;
  private readonly stale = new Emitter<void>();
  /** Fires when the viewer has other bytes than the list shown was read for. */
  readonly onStale = this.stale.event;

  constructor(
    private readonly host: {
      post(message: HostMessage): void;
      /** The hash of the bytes the viewer was given; missing until it has any. */
      sha256(): string | undefined;
    },
  ) {}

  /** The bookmarks as they are now in the file for `sha256`; `problem` says why it could not be read. */
  set(items: readonly Bookmark[], sha256: string, problem?: string): void {
    this.shown = { items: [...items], sha256, ...(problem ? { problem } : {}) };
    this.send(this.shown);
  }

  /** Send them again after a load, when the bytes are the ones they were read for. */
  rehydrate(): void {
    if (!this.shown) {
      return;
    }
    if (this.shown.sha256 === this.host.sha256()) {
      this.send(this.shown);
      return;
    }
    this.shown = undefined;
    this.stale.fire();
  }

  private send({ items, problem }: { items: Bookmark[]; problem?: string }) {
    this.host.post({
      type: "bookmarks",
      items,
      ...(problem ? { problem } : {}),
    });
  }
}
