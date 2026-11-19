/**
 * Writing a file so that a crash or a full disk never leaves it empty or
 * half written: the new contents go to a temporary file beside it, are
 * flushed to disk, and the temporary file is renamed over it. A reader sees
 * the old text or the new, never a truncated file.
 *
 * Replacing a file keeps its permissions. A symbolic link to it is kept too:
 * the file it names is replaced, never the link (renaming over the link
 * would turn it into a plain file). Other hard links to the old file keep the
 * old text, as with any editor that saves by renaming.
 */
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import * as path from "node:path";
import {
  assertOpenedInside,
  fileUriToPath,
  isWithin,
  OutsideWorkspace,
  writeInPlace,
} from "./paths";

export interface AtomicWriteOptions {
  /** The new file's permission bits; otherwise the default for a new file. */
  readonly mode?: number;
  /** A workspace root (a `file:` URI) the temporary file must be created in. */
  readonly root?: string | undefined;
}

/** Write beside the destination, then rename, so a crash never leaves half a file. */
export async function writeAtomic(
  file: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const folder = path.dirname(file);
  await mkdir(folder, { recursive: true });
  // Unpredictable and created exclusively, so nothing planted in its place is written through.
  const temporary = path.join(
    folder,
    `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow(),
    options.mode ?? 0o666,
  );
  try {
    if (options.root !== undefined) {
      await assertOpenedInside(handle, temporary, options.root);
    }
    if (options.mode !== undefined) {
      // `open` applies the umask; the replaced file's bits are what we want.
      await handle.chmod(options.mode);
    }
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Replace an existing file's contents atomically, keeping its permissions.
 * With a `root`, a symbolic link in the file's place is followed when the
 * file it names lies inside the root, and refused otherwise. Without one,
 * nothing says where a link may lead, so a link in the file's place is
 * refused, as an `O_NOFOLLOW` open would refuse it.
 */
export async function replaceFile(
  file: string,
  data: string | Uint8Array,
  root?: string,
): Promise<void> {
  const target = await replacedTarget(file, root);
  const { mode } = await stat(target);
  try {
    await writeAtomic(target, data, { mode: mode & 0o7777, root });
  } catch (error) {
    if (!cannotCreateBeside(error, target)) {
      throw error;
    }
    // A writable note in a folder that takes no new file still saves, as before.
    await writeInPlace(target, data, root);
  }
}

/** Whether `error` is the folder refusing the temporary file beside `target`. */
function cannotCreateBeside(error: unknown, target: string): boolean {
  const { code, syscall, path: failed } = error as NodeJS.ErrnoException;
  return (
    (code === "EACCES" || code === "EPERM") &&
    syscall === "open" &&
    typeof failed === "string" &&
    path.dirname(failed) === path.dirname(target)
  );
}

async function replacedTarget(
  file: string,
  root: string | undefined,
): Promise<string> {
  if (root === undefined) {
    if ((await lstat(file)).isSymbolicLink()) {
      throw Object.assign(
        new Error(`ELOOP: a symbolic link is not followed, '${file}'`),
        { code: "ELOOP" },
      );
    }
    return file;
  }
  const base = fileUriToPath(root);
  if (!base) {
    throw new OutsideWorkspace();
  }
  const [realRoot, target] = await Promise.all([
    realpath(base),
    realpath(file),
  ]);
  if (!isWithin(realRoot, target)) {
    throw new OutsideWorkspace();
  }
  return target;
}

const noFollow = (): number => constants.O_NOFOLLOW ?? 0;
