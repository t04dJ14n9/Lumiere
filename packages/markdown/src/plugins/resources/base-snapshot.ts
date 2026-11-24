import type { VaultFile, VaultIndex } from "../vault/api";
import type { BaseNoteEntry } from "./api";

/** What a base embed receives of its panel's snapshot of the vault's notes. */
export interface BaseSnapshotReply {
  /** The snapshot's version, which the page sends back as the one it holds. */
  snapshot: number;
  /** Every entry, when the page holds no usable copy. */
  entries?: BaseNoteEntry[];
  /** The entries that changed since the version the page holds. */
  changed?: BaseNoteEntry[];
  thisEntry?: BaseNoteEntry;
}

interface Built {
  version: number;
  entries: BaseNoteEntry[];
  byPath: Map<string, BaseNoteEntry>;
  /** The entries that changed from the version before, when it had the same notes. */
  delta?: { from: number; changed: BaseNoteEntry[] };
}

/**
 * One snapshot of the vault's notes for all of a panel's `.base` embeds.
 * It is built again only after the vault changed (`invalidate`), and a page
 * that holds a copy is sent nothing, or only the entries that changed since
 * the version before, rather than the whole vault for every embed.
 */
export class BaseSnapshots {
  private built?: Built;
  private isStale = true;
  private version = 0;
  constructor(private readonly vault: VaultIndex) {}

  /** The vault changed: the next reply builds the snapshot again. */
  invalidate(): void {
    this.isStale = true;
  }

  /**
   * The reply for a base embedded in the note at `source` (a vault path),
   * for a page that holds version `have` of the snapshot.
   */
  reply(
    source: string | undefined,
    have: number | undefined,
  ): BaseSnapshotReply {
    const built = this.current();
    const thisEntry = source ? built.byPath.get(source) : undefined;
    const reply = { snapshot: built.version, ...(thisEntry && { thisEntry }) };
    if (have === built.version) {
      return reply;
    }
    if (built.delta && have === built.delta.from) {
      return { ...reply, changed: built.delta.changed };
    }
    return { ...reply, entries: built.entries };
  }

  private current(): Built {
    if (this.built && !this.isStale) {
      return this.built;
    }
    this.isStale = false;
    const entries = this.build();
    const previous = this.built;
    const changed = previous && changedEntries(previous.entries, entries);
    if (previous && changed?.length === 0) {
      return previous;
    }
    this.built = {
      version: ++this.version,
      entries,
      byPath: new Map(entries.map((entry) => [entry.path, entry])),
      ...(previous &&
        changed && { delta: { from: previous.version, changed } }),
    };
    return this.built;
  }

  private build(): BaseNoteEntry[] {
    const { vault } = this;
    if (typeof vault.files !== "function") {
      return [];
    }
    const entries: BaseNoteEntry[] = [];
    const backlinks = backlinksByTarget(vault);
    for (const file of vault.files()) {
      if (!/^(?:md|markdown)$/i.test(file.extension) || file.excluded) {
        continue;
      }
      entries.push(buildNoteEntry(vault, file, backlinks.get(file.path) ?? []));
    }
    return entries;
  }
}

/**
 * The entries of `next` that differ from `previous`, or undefined when the
 * two do not list the same notes in the same order (a note was added,
 * removed or renamed): the page then needs every entry again. Entries are
 * plain JSON values, so their text compares them.
 */
function changedEntries(
  previous: readonly BaseNoteEntry[],
  next: readonly BaseNoteEntry[],
): BaseNoteEntry[] | undefined {
  if (previous.length !== next.length) {
    return undefined;
  }
  const changed: BaseNoteEntry[] = [];
  for (let index = 0; index < next.length; index++) {
    const before = previous[index]!;
    const after = next[index]!;
    if (before.path !== after.path) {
      return undefined;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed.push(after);
    }
  }
  return changed;
}

/**
 * Every note's backlinks, from one pass over the notes' resolved links.
 * The index computes one note's backlinks by inverting every note's links,
 * so asking it for each note costs n² for n notes.
 */
function backlinksByTarget(vault: VaultIndex): Map<string, string[]> {
  const byTarget = new Map<string, string[]>();
  if (typeof vault.resolvedLinks !== "function") {
    return byTarget;
  }
  for (const { path } of vault.files()) {
    for (const target of vault.resolvedLinks(path).keys()) {
      if (target === path) {
        continue;
      }
      const sources = byTarget.get(target);
      if (sources) {
        sources.push(path);
      } else {
        byTarget.set(target, [path]);
      }
    }
  }
  for (const sources of byTarget.values()) {
    sources.sort();
  }
  return byTarget;
}

function buildNoteEntry(
  vault: VaultIndex,
  file: VaultFile,
  backlinks: string[],
): BaseNoteEntry {
  const meta =
    typeof vault.metadata === "function"
      ? vault.metadata(file.path)
      : undefined;
  const frontmatter = sanitizeFrontmatter(meta?.frontmatter);
  const tags = collectNoteTags(meta?.tags, frontmatter);
  const links = meta?.links?.map((l) => l.link) ?? [];
  const embeds = meta?.embeds?.map((e) => e.link) ?? [];
  return {
    path: file.path,
    basename: file.basename,
    extension: file.extension,
    mtime: file.mtime,
    size: file.size,
    ...(frontmatter ? { frontmatter } : {}),
    tags,
    links,
    embeds,
    backlinks,
  };
}

function sanitizeFrontmatter(
  raw?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  // A nested object reads as its JSON, so a view shows its keys, not [object Object].
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function collectNoteTags(
  inlineTags?: readonly { tag: string }[],
  frontmatter?: Record<string, unknown>,
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  const addTag = (raw: unknown) => {
    if (typeof raw !== "string") {
      return;
    }
    const clean = raw.trim().replace(/^#/, "");
    if (!clean) {
      return;
    }
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(`#${clean}`);
    }
  };
  for (const t of inlineTags ?? []) {
    addTag(t.tag);
  }
  const fmTags = frontmatter?.tags ?? frontmatter?.tag;
  if (Array.isArray(fmTags)) {
    for (const item of fmTags) {
      addTag(item);
    }
  } else if (typeof fmTags === "string") {
    for (const part of fmTags.split(/[,\s]+/)) {
      addTag(part);
    }
  }
  return tags;
}
