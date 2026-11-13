import { diffSequences } from "../diff/myers";

/** The base's lines `from`–`to` (half-open) are replaced by `lines`. */
interface Hunk {
  from: number;
  to: number;
  lines: readonly string[];
}

/** The three texts of a note whose file changed under unsaved typing. */
export interface DiskChange {
  /** The text last read from or written to the file: what both sides changed. */
  saved: string;
  /** The unsaved text the user has now. */
  buffer: string;
  /** The text another program wrote to the file. */
  disk: string;
}

/**
 * A line-based three-way merge: the disk's changes applied onto the buffer, so
 * unsaved typing and another program's rewrite both survive (Obsidian merges
 * the same way when a note changes on disk under its editor).
 *
 * Conflict policy: where both sides changed the same lines, the buffer's lines
 * stay and the disk's are dropped. Unsaved text exists nowhere else, while the
 * other program still has its change to write again, and the buffer is what
 * the next save puts on disk anyway. A conflict does not affect changes in
 * other places. Two sides that inserted different lines at one place keep
 * both, the buffer's first; the same insertion, or the same replacement,
 * is applied once.
 *
 * Lines split at "\n" only, so a "\r" stays on its line and the text comes
 * back byte for byte.
 */
export function mergeDiskChange({ saved, buffer, disk }: DiskChange): string {
  if (buffer === disk || saved === disk) {
    return buffer;
  }
  if (saved === buffer) {
    return disk;
  }
  const base = saved.split("\n");
  const ours = buffer.split("\n");
  const theirs = disk.split("\n");
  const own = hunks(base, ours);
  const kept: string[][] = [];
  let at = 0;
  for (const edit of landing(own, hunks(base, theirs))) {
    kept.push(ours.slice(at, edit.from), [...edit.lines]);
    at = edit.to;
  }
  kept.push(ours.slice(at));
  return kept.flat().join("\n");
}

/** What changed from `base` to `other`: each run of changed lines is one hunk. */
function hunks(base: readonly string[], other: readonly string[]): Hunk[] {
  const found: { from: number; to: number; start: number; end: number }[] = [];
  let open = false;
  for (const run of diffSequences(base, other)) {
    if (run.type === "equal") {
      open = false;
    } else if (open) {
      const last = found[found.length - 1]!;
      last.to = run.aTo;
      last.end = run.bTo;
    } else {
      open = true;
      found.push({
        from: run.aFrom,
        to: run.aTo,
        start: run.bFrom,
        end: run.bTo,
      });
    }
  }
  return found.map((hunk) => ({
    from: hunk.from,
    to: hunk.to,
    lines: other.slice(hunk.start, hunk.end),
  }));
}

/**
 * The disk's hunks that do not clash with the buffer's, moved from the base's
 * lines to the buffer's. An unclashed hunk's lines are unchanged in the buffer,
 * so only the buffer's earlier hunks shift it.
 */
function landing(own: readonly Hunk[], disk: readonly Hunk[]): Hunk[] {
  const landed: Hunk[] = [];
  let next = 0;
  let shift = 0;
  for (const hunk of disk) {
    // A buffer hunk that ends where this one starts comes first, so an
    // insertion by each side at one place lands the buffer's first (unless
    // it is the same insertion, which `clashes` below must see).
    while (
      next < own.length &&
      own[next]!.to <= hunk.from &&
      !clashes(own[next]!, hunk)
    ) {
      const earlier = own[next++]!;
      shift += earlier.lines.length - (earlier.to - earlier.from);
    }
    if (next < own.length && clashes(own[next]!, hunk)) {
      continue;
    }
    landed.push({
      from: hunk.from + shift,
      to: hunk.to + shift,
      lines: hunk.lines,
    });
  }
  return landed;
}

/**
 * Whether the buffer's hunk already covers the disk's: they touch some of the
 * same base lines, or they insert the same lines at the same place. Hunks that
 * only meet (one ends where the other starts) do not clash.
 */
function clashes(own: Hunk, disk: Hunk): boolean {
  if (own.from === own.to && disk.from === disk.to && own.from === disk.from) {
    return (
      own.lines.length === disk.lines.length &&
      own.lines.every((line, at) => line === disk.lines[at])
    );
  }
  return own.from < disk.to && disk.from < own.to;
}
