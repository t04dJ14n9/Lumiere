/** A vault's flat file list as nested folders, for the file tree. */
import type { FileEntry, VaultFiles } from "./api";

export interface Folder {
  readonly name: string;
  /** Relative to the vault, with `/`; "" for the vault itself. */
  readonly path: string;
  readonly folders: Map<string, Folder>;
  readonly files: FileEntry[];
}

/**
 * Folders and files in the order the list gives them; the server sorts
 * the list by path, so siblings come out sorted by name.
 */
export function buildTree(files: readonly FileEntry[]): Folder {
  const root: Folder = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (const name of parts.slice(0, -1)) {
      let child = folder.folders.get(name);
      if (!child) {
        const path = folder.path ? `${folder.path}/${name}` : name;
        child = { name, path, folders: new Map(), files: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.files.push(file);
  }
  return root;
}

/** The folders that hold a file, from the vault down: `a/b/c.md` → `a`, `a/b`. */
export function foldersAbove(path: string): readonly string[] {
  const names = path.split("/").slice(0, -1);
  return names.map((_, index) => names.slice(0, index + 1).join("/"));
}

/** Whether two listings name the same files, of the same kinds, in order. */
export function sameListing(a: VaultFiles, b: VaultFiles): boolean {
  return (
    a.partial === b.partial &&
    a.files.length === b.files.length &&
    a.files.every(
      (file, index) =>
        file.path === b.files[index]?.path &&
        file.kind === b.files[index]?.kind,
    )
  );
}
