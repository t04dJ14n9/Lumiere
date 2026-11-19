import { isMarkdownPath } from "../../shared/vault-path";

/**
 * A walk may read this many times the limit in entries before it stops, so
 * a huge folder of other files ends the listing rather than every folder.
 */
const WALK_FACTOR = 10;

/**
 * Which files a vault listing keeps (`VaultFileSystem.list`). Notes and
 * other files count against the limit apart: in a large code repository
 * the other files would otherwise fill it first, and which notes are
 * indexed would depend on the order of the walk.
 */
export class ListingBudget {
  private notes = 0;
  private others = 0;
  private seen = 0;
  private isNoteRefused = false;
  /** A file was refused, or the walk stopped before its end. */
  isPartial = false;

  constructor(private readonly limit: number) {}

  /** Whether the listing keeps the file at this vault path. */
  admit(path: string): boolean {
    this.seen++;
    const isNote = isMarkdownPath(path);
    const kept = isNote ? this.notes : this.others;
    if (kept >= this.limit) {
      this.isPartial = true;
      this.isNoteRefused ||= isNote;
      return false;
    }
    if (isNote) {
      this.notes++;
    } else {
      this.others++;
    }
    return true;
  }

  /** The walk can stop: it refused a note, or saw far more than it keeps. */
  get isSpent(): boolean {
    return this.isNoteRefused || this.seen >= this.limit * WALK_FACTOR;
  }

  /** The walk stopped with `unvisited` folders left. */
  stop(unvisited: number): void {
    if (unvisited > 0) {
      this.isPartial = true;
    }
  }
}
