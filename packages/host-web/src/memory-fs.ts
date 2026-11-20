/**
 * Files in memory (vault-fs.ts): a demo vault, the host's data in tests, or
 * a store that keeps every change somewhere else as it happens (`persist`:
 * the web app's IndexedDB, where a browser cannot write its own storage).
 */
import { notFound, type VaultFileSystem } from "./vault-fs";

export type MemoryEntry =
  | { readonly kind: "file"; data: Uint8Array; mtime: number }
  | { readonly kind: "folder"; mtime: number };

/**
 * Hears each entry set (or removed, as undefined), by path. A change it
 * returns a promise for is done only when that settles: a rejection fails
 * the write (and undoes it here), so a note is never shown as saved when it
 * was not kept.
 */
export type Persist = (
  path: string,
  entry: MemoryEntry | undefined,
) => void | Promise<void>;

export class MemoryFileSystem implements VaultFileSystem {
  private readonly entries = new Map<string, MemoryEntry>([
    ["", { kind: "folder", mtime: Date.now() }],
  ]);

  /**
   * Files to start with, by path (text or bytes), or entries a `persist` kept
   * before; `persist` then hears every change.
   */
  constructor(
    files:
      | Readonly<Record<string, string | Uint8Array>>
      | ReadonlyMap<string, MemoryEntry> = {},
    private readonly persist: Persist = () => {},
  ) {
    if (files instanceof Map) {
      for (const [path, entry] of files) {
        this.entries.set(clean(path), entry);
      }
      return;
    }
    for (const [path, content] of Object.entries(files)) {
      this.put(path, content);
    }
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(clean(path));
    if (entry?.kind !== "file") {
      throw notFound(path);
    }
    return entry.data.slice();
  }

  async write(
    path: string,
    data: Uint8Array,
    mode: "replace" | "create",
  ): Promise<void> {
    const key = clean(path);
    const entry = this.entries.get(key);
    if (mode === "create" && entry) {
      return;
    }
    if (mode === "replace" && entry?.kind !== "file") {
      throw notFound(path);
    }
    this.requireFolder(parentOf(key));
    await this.set(key, {
      kind: "file",
      data: data.slice(),
      mtime: Date.now(),
    });
  }

  async stat(path: string) {
    const entry = this.entries.get(clean(path));
    if (!entry) {
      return undefined;
    }
    const size = entry.kind === "file" ? entry.data.length : 0;
    return { kind: entry.kind, mtime: entry.mtime, size };
  }

  async list(path: string) {
    const key = clean(path);
    if (this.entries.get(key)?.kind !== "folder") {
      return undefined;
    }
    const prefix = key ? `${key}/` : "";
    return [...this.entries]
      .filter(([name]) => name.startsWith(prefix) && name !== key)
      .map(([name, entry]) => ({
        name: name.slice(prefix.length),
        kind: entry.kind,
      }))
      .filter(({ name }) => !name.includes("/"));
  }

  async mkdir(path: string): Promise<void> {
    let current = "";
    for (const part of clean(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const entry = this.entries.get(current);
      if (entry?.kind === "file") {
        throw new Error(`A file is in the way: ${current}`);
      }
      if (!entry) {
        await this.set(current, { kind: "folder", mtime: Date.now() });
      }
    }
  }

  async remove(path: string): Promise<void> {
    const key = clean(path);
    if ((await this.list(key))?.length) {
      throw new Error(`Folder not empty: ${path}`);
    }
    await this.unset(key);
  }

  async move(from: string, to: string): Promise<void> {
    const source = clean(from);
    const target = clean(to);
    if (!this.entries.has(source)) {
      throw notFound(from);
    }
    this.requireFolder(parentOf(target));
    const kept: Promise<void>[] = [];
    for (const [name, entry] of [...this.entries]) {
      if (name === source || name.startsWith(`${source}/`)) {
        kept.push(this.unset(name));
        kept.push(this.set(target + name.slice(source.length), entry));
      }
    }
    await Promise.all(kept);
  }

  /**
   * Synchronous setup, for files to start with: in memory at once, and
   * handed to `persist` without waiting for it.
   */
  put(path: string, content: string | Uint8Array): void {
    const key = clean(path);
    let current = "";
    for (const part of parentOf(key).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.entries.has(current)) {
        this.setUnwaited(current, { kind: "folder", mtime: Date.now() });
      }
    }
    const data =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.setUnwaited(key, { kind: "file", data, mtime: Date.now() });
  }

  private setUnwaited(path: string, entry: MemoryEntry): void {
    this.set(path, entry).catch((error: unknown) =>
      console.error(`Lumière could not keep ${path}`, error),
    );
  }

  private set(path: string, entry: MemoryEntry): Promise<void> {
    const before = this.entries.get(path);
    this.entries.set(path, entry);
    return this.keep(path, entry, () => {
      // A later change to the same path wins; only undo our own.
      if (this.entries.get(path) !== entry) {
        return;
      }
      if (before) {
        this.entries.set(path, before);
      } else {
        this.entries.delete(path);
      }
    });
  }

  private unset(path: string): Promise<void> {
    const before = this.entries.get(path);
    if (!before) {
      return Promise.resolve();
    }
    this.entries.delete(path);
    return this.keep(path, undefined, () => {
      if (!this.entries.has(path)) {
        this.entries.set(path, before);
      }
    });
  }

  private async keep(
    path: string,
    entry: MemoryEntry | undefined,
    undo: () => void,
  ): Promise<void> {
    try {
      await this.persist(path, entry);
    } catch (error) {
      undo();
      throw error;
    }
  }

  private requireFolder(path: string): void {
    if (this.entries.get(path)?.kind !== "folder") {
      throw notFound(path);
    }
  }
}

function clean(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}
