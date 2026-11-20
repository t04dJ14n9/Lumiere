import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Tells a real change to a watched git metadata folder from a notification
 * that changed nothing. On Windows `fs.watch` also reports a file's last
 * access, attributes and security, so git only reading `.git` (or a virus
 * scanner opening a new object) would count as a change and make every
 * blame stale. Each file's identity, size and modification time are kept
 * from when the watch starts; a notification counts only when they differ.
 */
export class MetadataChanges {
  private readonly seen = new Map<string, string>();

  /** Remembers what `dir` holds now: its entries, or its whole tree. */
  constructor(
    private readonly dir: string,
    recursive: boolean,
  ) {
    for (const entry of listEntries(dir, recursive)) {
      this.seen.set(entry, signature(join(dir, entry)));
    }
  }

  /**
   * Whether the entry a notification names (relative to the folder) is not
   * what it was. A notification that names nothing may be anything.
   */
  changed(entry: string | null): boolean {
    if (entry === null) {
      return true;
    }
    const now = signature(join(this.dir, entry));
    if (this.seen.get(entry) === now) {
      return false;
    }
    this.seen.set(entry, now);
    return true;
  }
}

function listEntries(dir: string, recursive: boolean): string[] {
  try {
    return readdirSync(dir, { recursive, encoding: "utf8" });
  } catch {
    return [];
  }
}

/**
 * Identity, size and modification time: what git's own writes change. Git
 * replaces a file by renaming a lock over it (a new identity) or appends to
 * it (a new size and time). The access time and the change time are left
 * out, since only reading the file or touching its attributes moves them.
 */
function signature(file: string): string {
  try {
    const info = statSync(file, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}`;
  } catch {
    return "missing";
  }
}
