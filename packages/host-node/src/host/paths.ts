/**
 * Workspace path checks for the Node host. The same rules as VS Code's
 * `contained`: a file URI is inside a root only after `..` and percent-encoding
 * are resolved, and an existing symlink must still land inside that root.
 * A string prefix is not enough: `file:///vault/../etc/passwd` starts with the
 * vault's URI and then leaves it.
 */
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { OutsideWorkspace } from "./platform";

export { OutsideWorkspace } from "./platform";

/** Filesystem path of a `file:` URI, or undefined when it is not one. */
export function fileUriToPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") {
      return undefined;
    }
    // Throws on an encoded slash, which would hide a separator from a prefix check.
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

/**
 * Whether `uri` is `root` or a file inside it. Dot segments are resolved, so
 * a path that only looks prefixed is outside.
 */
export function isInside(root: string, uri: string): boolean {
  const base = fileUriToPath(root);
  const target = fileUriToPath(uri);
  if (base === undefined || target === undefined) {
    return false;
  }
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/** `/` on POSIX, or a drive root. Opening one would expose the whole disk. */
export function isFilesystemRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return resolved === path.parse(resolved).root;
}

/**
 * Reject `uri` unless it stays inside `root` lexically and, once the nearest
 * existing ancestor is resolved, on disk. A missing final component is allowed
 * so a new note can be created; a symlink that leaves the root is not.
 */
export async function assertContained(
  rootUri: string,
  uri: string,
): Promise<void> {
  const base = fileUriToPath(rootUri);
  const target = fileUriToPath(uri);
  if (!base || !target || !isInside(rootUri, uri)) {
    throw new OutsideWorkspace();
  }
  const root = await realpath(base);
  const resolved = await nearestExisting(target);
  if (!isWithin(root, resolved)) {
    throw new OutsideWorkspace();
  }
}

/** Whether the real path `resolved` is `root` or below it. */
function isWithin(root: string, resolved: string): boolean {
  const relative = path.relative(root, resolved);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

/** The path to open for `uri` once it is inside one of `roots`. */
export async function pathInsideRoots(
  roots: readonly string[],
  uri: string,
): Promise<string> {
  const root = roots.find((item) => isInside(item, uri));
  const file = fileUriToPath(uri);
  if (!root || !file) {
    throw new OutsideWorkspace();
  }
  await assertContained(root, uri);
  return file;
}

export interface ResolvedNote {
  readonly note: string;
  readonly root: string;
}

/**
 * The note and workspace to open, both canonical. Undefined when the note is
 * missing, not a file, or not inside `root` — including through a symlink or
 * a workspace that is the filesystem root.
 */
export async function resolveContainedNote(
  note: string,
  root: string,
): Promise<ResolvedNote | undefined> {
  if (
    !path.isAbsolute(note) ||
    !path.isAbsolute(root) ||
    isFilesystemRoot(root)
  ) {
    return undefined;
  }
  let realRoot: string;
  let realNote: string;
  try {
    realRoot = await realpath(root);
    realNote = await realpath(note);
  } catch {
    return undefined;
  }
  if (isFilesystemRoot(realRoot)) {
    return undefined;
  }
  try {
    await assertContained(
      pathToFileURL(realRoot).toString(),
      pathToFileURL(realNote).toString(),
    );
  } catch {
    return undefined;
  }
  return { note: realNote, root: realRoot };
}

/*
 * Writes and reads below take the workspace `root` (a `file:` URI) and check
 * the file they opened, not only the path they were asked for.
 * `assertContained` resolves a path, and `open` resolves it again later: a
 * directory swapped for a symlink in between would send the open outside the
 * workspace, and `O_NOFOLLOW` guards only the last component. Node has no
 * `openat`, so the ancestors cannot be pinned while the file is opened. What
 * can be done is to open without truncating, then ask the kernel which file
 * the descriptor is (`assertOpenedInside`), and only then truncate, write or
 * read. A swap that sends the open outside is then caught before any byte of
 * an outside file is changed or returned, and the swap cannot be hidden by
 * swapping back: the descriptor would still be the outside file, whose
 * device and inode are not those of the path's file inside.
 *
 * Left over: a file created through the swapped directory exists, empty,
 * until it is removed (best effort), and `mkdir` through it can leave empty
 * folders outside. Without a `root` nothing is verified.
 */

/**
 * Throw `OutsideWorkspace` unless `handle`, opened from `file`, is the file
 * that `file` names now and that file lies inside `rootUri` once links are
 * resolved. The device and inode comparison ties the descriptor to the
 * checked real path; the containment check binds that path to the root.
 */
export async function assertOpenedInside(
  handle: FileHandle,
  file: string,
  rootUri: string,
): Promise<void> {
  const base = fileUriToPath(rootUri);
  if (!base) {
    throw new OutsideWorkspace();
  }
  const real = await realpath(file);
  const [root, opened, named] = await Promise.all([
    realpath(base),
    handle.stat({ bigint: true }),
    stat(real, { bigint: true }),
  ]);
  if (
    !isWithin(root, real) ||
    opened.dev !== named.dev ||
    opened.ino !== named.ino
  ) {
    throw new OutsideWorkspace();
  }
}

/** Open `file`, and with a `root`, close it again unless it is inside it. */
async function openVerified(
  file: string,
  flags: number,
  root: string | undefined,
): Promise<FileHandle> {
  const handle = await open(file, flags);
  if (root === undefined) {
    return handle;
  }
  try {
    await assertOpenedInside(handle, file, root);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
}

/**
 * Replace a file without following a symlink at the final path. `writeFile`
 * would follow one planted after the containment check and write outside.
 * The open does not truncate: that waits until `root` is verified.
 */
export async function writeThroughFile(
  file: string,
  text: string,
  root?: string,
): Promise<void> {
  await replaceContents(file, text, root);
}

/** Like `writeThroughFile`, for binary payloads (images). */
export async function writeThroughBytes(
  file: string,
  data: Uint8Array,
  root?: string,
): Promise<void> {
  await replaceContents(file, data, root);
}

async function replaceContents(
  file: string,
  data: string | Uint8Array,
  root: string | undefined,
): Promise<void> {
  const handle = await openVerified(
    file,
    constants.O_WRONLY | noFollow(),
    root,
  );
  try {
    await handle.truncate(0);
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/** The bytes of `file`, read only once the opened file is verified inside `root`. */
export async function readContainedBytes(
  file: string,
  root: string,
): Promise<Buffer> {
  // A link is followed here, as `readFile` does: one inside the root is fine.
  const handle = await openVerified(file, constants.O_RDONLY, root);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Create an empty file and say so (true), or leave an existing one untouched
 * (false). `O_EXCL` makes the check and the creation one step. With a `root`,
 * a file that turns out to lie outside it is removed again and refused.
 */
export async function createEmptyFile(
  file: string,
  root?: string,
): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(
      file,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow(),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return false;
  }
  try {
    if (root !== undefined) {
      await assertOpenedInside(handle, file, root);
    }
    return true;
  } catch (error) {
    await removeCreated(handle, file);
    throw error;
  } finally {
    await handle.close();
  }
}

/** Unlink `file` if it still is the file `handle` created; best effort. */
async function removeCreated(handle: FileHandle, file: string): Promise<void> {
  try {
    const [created, named] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(file, { bigint: true }),
    ]);
    if (created.dev === named.dev && created.ino === named.ino) {
      await unlink(file);
    }
  } catch {
    // Gone already, or replaced by something that is not ours to remove.
  }
}

/** Write beside the destination, then rename, so a crash never leaves half a file. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, file);
}

const noFollow = (): number => constants.O_NOFOLLOW ?? 0;

/** `realpath` of `file`, or of the nearest ancestor that exists. */
async function nearestExisting(file: string): Promise<string> {
  let candidate = file;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // `realpath` throws ENOENT for a dangling symlink as well as a missing
      // path; a symlink whose target is missing could point outside the root.
      if (await isSymbolicLink(candidate)) {
        throw new OutsideWorkspace();
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

async function isSymbolicLink(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
