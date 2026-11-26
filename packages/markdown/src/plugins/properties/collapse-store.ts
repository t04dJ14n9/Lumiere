import {
  COLLAPSED_NOTES_KEY,
  collapsedNotes,
  isPropertiesCollapsed,
} from "../../shared/properties-collapse";
import type { PreferenceStorage } from "./type-store";

/**
 * Whether a note's Properties are collapsed. As in Obsidian 1.14 it is kept
 * per note (collapsing one note leaves the others open, and a note keeps its
 * state when reopened); only collapsed notes are stored.
 */
export class PropertyCollapseStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<
    (note: string, collapsed: boolean) => void
  >();

  constructor(private readonly storage: PreferenceStorage) {}

  read(note: string): boolean {
    return isPropertiesCollapsed(this.storage, note);
  }

  set(note: string, collapsed: boolean): Promise<void> {
    const update = this.pending.then(async () => {
      const rest = { ...collapsedNotes(this.storage) };
      delete rest[note];
      await this.storage.update(
        COLLAPSED_NOTES_KEY,
        collapsed ? { ...rest, [note]: true } : rest,
      );
      for (const listener of this.listeners) {
        listener(note, collapsed);
      }
    });
    this.pending = update.catch(() => {});
    return update;
  }

  subscribe(listener: (note: string, collapsed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
