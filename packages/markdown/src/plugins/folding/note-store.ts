import type { WorkspaceStorage } from "../../shared/host";
import { savedFolds, type NoteFolds } from "./protocol";

/** Notes whose folds are kept; the least recently saved go first. */
export const MAX_NOTES = 500;
const KEY = "markdownNoteFolds";

/** A panel, as the store tells panels apart. */
export type FoldPanel = object;

/**
 * Each note's folds, saved in workspace storage, as Obsidian keeps folds per
 * file. Two panels of one note keep their own folds while they are open;
 * the note's record is the folds of the panel where the reader last folded
 * or unfolded (its "writer"), kept up to date as the text changes in it.
 * Another panel's edits, or its closing, never overwrite it, so the panels
 * do not undo each other's folds. A note opened when no open panel holds
 * its record makes that panel the writer.
 */
export class NoteFoldStore {
  private pending: Promise<void> = Promise.resolve();

  /**
   * @param writers Which open panel holds each note's record. It belongs to
   *   the window, not to a storage object: a panel's host services may be
   *   its own copies of the window's.
   */
  constructor(
    private readonly storage: WorkspaceStorage,
    private readonly writers = new Map<string, FoldPanel>(),
  ) {}

  private notes(): Record<string, unknown> {
    const value = this.storage.get<unknown>(KEY, {});
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /** The note's saved folds, if any panel saved them; malformed ones are none. */
  read(note: string): NoteFolds | undefined {
    const value = this.notes()[note];
    if (value === undefined) {
      return undefined;
    }
    try {
      return savedFolds.parse(value);
    } catch {
      return undefined;
    }
  }

  /** `panel` opened `note`: it holds the record unless another panel does. */
  open(note: string, panel: FoldPanel): void {
    if (!this.writers.has(note)) {
      this.writers.set(note, panel);
    }
  }

  /** `panel` closed: the record stays as it last saved it. */
  close(note: string, panel: FoldPanel): void {
    if (this.writers.get(note) === panel) {
      this.writers.delete(note);
    }
  }

  /**
   * Save `panel`'s folds as the note's. A claim (the reader folded there)
   * always takes the record; an update after a text change only while the
   * panel holds it. Answers whether the folds were taken.
   */
  save(
    note: string,
    panel: FoldPanel,
    change: { folds: NoteFolds; claim: boolean },
  ): Promise<boolean> {
    if (change.claim) {
      this.writers.set(note, panel);
    } else if (this.writers.get(note) !== panel) {
      return Promise.resolve(false);
    }
    const update = this.pending.then(async () => {
      // Re-inserting moves the note last, so the oldest are dropped first.
      const rest = { ...this.notes() };
      delete rest[note];
      const kept = Object.entries(rest).slice(-(MAX_NOTES - 1));
      await this.storage.update(
        KEY,
        Object.fromEntries([...kept, [note, change.folds]]),
      );
      return true;
    });
    this.pending = update.then(
      () => {},
      () => {},
    );
    return update;
  }
}
