/**
 * The shared host's platform on Node (platform.ts): the file system, a data
 * folder for the host's own files, worker threads and node:crypto. The
 * safety rules live in paths.ts: containment through real paths, saves
 * that never follow a symbolic link, creation that never overwrites.
 */
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nodeWorkerLauncher, realContains } from "@workshop/markdown/node";
import {
  assertContained,
  createEmptyFile,
  fileUriToPath,
  isInside,
  readContainedBytes,
} from "./paths";
import type { HostEntry, HostFiles, HostPlatform, HostStore } from "./platform";
import { fileUri } from "./uris";
import { listVault, listVaultPaths } from "./vault";
import { replaceFile, writeAtomic } from "./atomic-write";
import { watchFile } from "./watch";
import { watchTree } from "./watch-tree";

export interface NodePlatformOptions {
  /** Where settings, state and vault snapshots are kept. */
  readonly data: string;
  /** The built workers (`markdown/workers`). */
  readonly workers: string;
}

export function createNodePlatform(options: NodePlatformOptions): HostPlatform {
  return {
    files: nodeFiles,
    store: folderStore(options.data),
    workers: nodeWorkerLauncher(options.workers),
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
    async writeScratchFile(name, text) {
      const folder = path.join(options.data, "agent");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const file = path.join(folder, path.basename(name));
      await writeFile(file, text, { mode: 0o600 });
      return pathToFileURL(file).toString();
    },
  };
}

/** A file, a folder, or anything else (a symbolic link in a listing, a socket). */
function kindOf(entry: {
  isFile(): boolean;
  isDirectory(): boolean;
}): HostEntry["kind"] {
  if (entry.isFile()) {
    return "file";
  }
  return entry.isDirectory() ? "folder" : "other";
}

/** A `file:` URI's path; throws for any other URI, as Node's own calls would. */
function toFile(uri: string): string {
  const file = fileUriToPath(uri);
  if (file === undefined) {
    throw new Error(`Not a file URI: ${uri}`);
  }
  return file;
}

/** Keeps a byte order mark as U+FEFF, so a save writes it back. */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A file's text. Bytes that are not UTF-8 are refused: decoding them would
 * put U+FFFD in their place, and the next save would write that over the
 * file, losing what they were.
 */
function decodeText(bytes: Uint8Array, file: string): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new Error(
      `${path.basename(file)} is not UTF-8 text. Lumière does not open it, so that saving cannot rewrite it.`,
    );
  }
}

export const nodeFiles: HostFiles = {
  isInside,
  contain: assertContained,
  readText: async (uri, root) => {
    const file = toFile(uri);
    const bytes =
      root === undefined
        ? await readFile(file)
        : await readContainedBytes(file, root);
    return decodeText(bytes, file);
  },
  readBytes: (uri, root) =>
    root === undefined
      ? readFile(toFile(uri))
      : readContainedBytes(toFile(uri), root),
  save: (uri, text, root) => replaceFile(toFile(uri), text, root),
  saveBytes: (uri, data, root) => replaceFile(toFile(uri), data, root),
  create: (uri, root) => createEmptyFile(toFile(uri), root),
  async stat(uri) {
    try {
      const info = await stat(toFile(uri));
      return { kind: kindOf(info), mtime: info.mtimeMs, size: info.size };
    } catch {
      return undefined;
    }
  },
  async linkStat(uri) {
    try {
      const info = await lstat(toFile(uri));
      return { mtime: info.mtimeMs, symbolicLink: info.isSymbolicLink() };
    } catch {
      return undefined;
    }
  },
  async list(uri) {
    try {
      const entries = await readdir(toFile(uri), { withFileTypes: true });
      return entries.map((entry): HostEntry => ({
        name: entry.name,
        kind: kindOf(entry),
      }));
    } catch {
      return undefined;
    }
  },
  mkdir: async (uri) => {
    await mkdir(toFile(uri), { recursive: true });
  },
  copy: (from, to) =>
    cp(toFile(from), toFile(to), { recursive: true, force: true }),
  move: (from, to) => moveEntry(toFile(from), toFile(to)),
  // A file or an empty folder, not a tree: VS Code's workspace fs deletes
  // one entry.
  remove: (uri) => removeEntry(toFile(uri)),
  watch: (uri, listener) => watchFile(toFile(uri), listener),
  watchTree: (uri, listener) => watchTree(toFile(uri), listener),
  toPath: (uri) => fileURLToPath(uri),
  // Through this runtime's own pathToFileURL, whatever it encodes.
  uriOf: (file) => pathToFileURL(fileURLToPath(fileUri(file))).href,
  realContains,
};

/** One file, or an empty folder, which `rm` without `recursive` refuses. */
async function removeEntry(file: string): Promise<void> {
  try {
    await rm(file, { recursive: false, force: true });
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_FS_EISDIR") {
      throw error;
    }
    await rmdir(file);
  }
}

/**
 * Move a file or folder as VS Code's rename without overwrite does: a
 * target that exists is refused (a rename would replace a file silently),
 * unless it is the same file under another case of its name; across
 * devices, it is copied and the original removed.
 */
async function moveEntry(from: string, to: string): Promise<void> {
  const [source, target] = await Promise.all([
    lstat(from, { bigint: true }),
    lstat(to, { bigint: true }).catch(() => undefined),
  ]);
  if (target && (target.dev !== source.dev || target.ino !== source.ino)) {
    throw Object.assign(new Error(`EEXIST: file already exists, '${to}'`), {
      code: "EEXIST",
    });
  }
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await cp(from, to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await rm(from, { recursive: true, force: true });
  }
}

/** The host's own files, in a folder. */
function folderStore(folder: string): HostStore {
  return {
    async read(name) {
      try {
        return await readFile(path.join(folder, name), "utf8");
      } catch {
        return undefined;
      }
    },
    write: (name, text) => writeAtomic(path.join(folder, name), text),
  };
}

/** Every file under a vault root (vault.ts `listVault`), on Node's file system. */
export function listNodeVault(root: string, limit: number, shallow = false) {
  return listVault(nodeFiles, { root, limit, shallow });
}

/** The paths of the files under a vault root (vault.ts `listVaultPaths`), on Node's file system. */
export function listNodeVaultPaths(root: string, limit: number) {
  return listVaultPaths(nodeFiles, { root, limit });
}
