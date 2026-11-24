import type { FileEvent, VaultListing } from "./api";
import type { MemoryVaultIndex } from "./memory-index";

/** Obsidian's limit is higher; past this the index says it is partial. */
export const FILE_LIMIT = 50_000;

export interface FileLimitOptions {
  /** Notes, and other files, kept apart; default `FILE_LIMIT`. */
  listingLimit?: number;
  /** Called once: the first time a listing or an event is refused for the limit. */
  onPartial?: () => void;
}

/**
 * How many files of each kind (notes, other files) an index keeps, as a
 * listing's budget does. A listing stops at the limit, and so do events: a
 * new file is not indexed once the index holds as many files of its kind.
 */
export class FileLimit {
  readonly perKind: number;
  private isReported = false;

  constructor(
    private readonly options: FileLimitOptions,
    private readonly index: Pick<MemoryVaultIndex, "file" | "isFull">,
  ) {
    this.perKind = options.listingLimit ?? FILE_LIMIT;
  }

  /**
   * Whether the event's file must stay out of the index. A file the index
   * has, or one renamed from a path it has, adds nothing.
   */
  refuses(event: Exclude<FileEvent, { type: "delete" }>): boolean {
    const { path } = event.file;
    const isKnown =
      this.index.file(path) ||
      (event.type === "rename" && this.index.file(event.oldPath));
    if (isKnown || !this.index.isFull(path, this.perKind)) {
      return false;
    }
    this.reportPartial();
    return true;
  }

  /** A listing that stopped at the limit says so, as an event it refuses does. */
  reportListing(listing: Pick<VaultListing, "partial">): void {
    if (listing.partial) {
      this.reportPartial();
    }
  }

  /** Once: a vault past the limit would warn at every file it refuses. */
  private reportPartial(): void {
    if (!this.isReported) {
      this.isReported = true;
      this.options.onPartial?.();
    }
  }
}
