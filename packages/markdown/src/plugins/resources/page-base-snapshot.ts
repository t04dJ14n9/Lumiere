import type { BaseNoteEntry, Resource } from "./api";

/**
 * The page's copy of its panel's base snapshot (`BaseSnapshots` on the
 * host). Each base load says which version it holds; the reply carries the
 * whole snapshot, the entries that changed since, or nothing, and `take`
 * hands the embed every entry either way.
 */
export class PageBaseSnapshot {
  private version?: number;
  private entries: BaseNoteEntry[] = [];

  /** The version to tell the host this page holds. */
  get have(): number | undefined {
    return this.version;
  }

  take(resource: Resource): Resource {
    if (resource.kind !== "base" || resource.snapshot === undefined) {
      return resource;
    }
    const { snapshot, changed, ...rest } = resource;
    if (this.version !== undefined && snapshot < this.version) {
      // A reply that left before a newer one came: what the page holds is
      // newer than any change it could carry.
      return { ...rest, entries: this.entries };
    }
    if (resource.entries) {
      this.entries = resource.entries;
    } else if (changed) {
      const byPath = new Map(changed.map((entry) => [entry.path, entry]));
      this.entries = this.entries.map(
        (entry) => byPath.get(entry.path) ?? entry,
      );
    }
    this.version = snapshot;
    return { ...rest, entries: this.entries };
  }
}
