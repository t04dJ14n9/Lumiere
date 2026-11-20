/**
 * The file tree's changes as paths, before any is asked of the host: where
 * a new note or folder goes, what a typed name may be, and where a dragged
 * file lands. Paths are relative to the vault, with `/`; "" is the vault.
 */

/** `name` in `folder`. */
export function childPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** The folder `path` is in; "" for the vault's own files. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Why a typed file or folder name cannot be used; undefined when it can. */
export function nameProblem(name: string): string | undefined {
  if (name.trim() === "") {
    return "A name is needed.";
  }
  if (/[/\\\0]/.test(name)) {
    return "A name cannot contain / or \\.";
  }
  if (name === "." || name === "..") {
    return "That name is taken by the system.";
  }
  if (name !== name.trim()) {
    return "A name cannot start or end with a space.";
  }
  return undefined;
}

/**
 * The first free name in `folder`: `Untitled.md`, then `Untitled 1.md`,
 * and so on, as Obsidian names a new note. `taken` holds the vault's paths.
 */
export function freeName(
  taken: ReadonlySet<string>,
  folder: string,
  { base = "Untitled", extension = "" }: { base?: string; extension?: string },
): string {
  for (let n = 0; ; n++) {
    const name = n === 0 ? `${base}${extension}` : `${base} ${n}${extension}`;
    if (!taken.has(childPath(folder, name))) {
      return childPath(folder, name);
    }
  }
}

/** Every path in the vault, and every folder above one, as `freeName` takes them. */
export function takenPaths(paths: Iterable<string>): Set<string> {
  const taken = new Set<string>();
  for (const path of paths) {
    taken.add(path);
    for (let folder = parentOf(path); folder; folder = parentOf(folder)) {
      taken.add(folder);
    }
  }
  return taken;
}

/**
 * Where `source` lands when dropped on `folder`, or undefined when it may
 * not go there: into itself or a folder inside it, or where it already is.
 */
export function dropTarget(source: string, folder: string): string | undefined {
  if (folder === source || folder.startsWith(`${source}/`)) {
    return undefined;
  }
  if (parentOf(source) === folder) {
    return undefined;
  }
  return childPath(folder, nameOf(source));
}

/** The folder a row's New Note and New Folder go in: a folder itself, a file's folder. */
export function folderFor(row: {
  readonly kind: "folder" | "file";
  readonly path: string;
}): string {
  return row.kind === "folder" ? row.path : parentOf(row.path);
}

/** The paths a drag carries, as the tree's rows set them. */
export const DRAGGED_PATH = "application/x-lumiere-path";
