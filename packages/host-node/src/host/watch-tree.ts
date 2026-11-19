/**
 * Watching a folder and everything under it (platform.ts `watchTree`).
 *
 * Node's recursive `fs.watch` is native on macOS and Windows. On Linux it is
 * JavaScript: when a subfolder appears it reads it synchronously inside the
 * change handler, and if the folder is already gone (git, sync tools and
 * editors create and remove folders quickly) the read throws there. That
 * escapes as an uncaught exception, never to `watcher.on("error")`, and
 * ends the server. So on Linux each folder gets its own plain watcher,
 * added and removed here, every step guarded. The folders are read
 * asynchronously, so a large vault does not hold up the server while its
 * watch starts, and hidden folders and `node_modules`, which the vault
 * ignores, are not watched: each would cost an inotify watch.
 *
 * A watch that fails (the folder went away for a moment, the system ran out
 * of watches) is armed again after a pause, for as long as it is wanted.
 */
import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import * as path from "node:path";

type Listener = (relative: string) => void;

/** The first pause before a failed watch is armed again; it doubles up to `MAX_REARM_MS`. */
export const FIRST_REARM_MS = 1_000;
const MAX_REARM_MS = 30_000;

export function watchTree(
  base: string,
  listener: Listener,
  platform: NodeJS.Platform = process.platform,
): () => void {
  return platform === "linux"
    ? watchFolderByFolder(base, listener)
    : watchNatively(base, listener);
}

/** A folder the vault never lists (vault.ts `isIgnoredPath`), so never watched folder by folder. */
export function isIgnoredFolder(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/**
 * Keeps one watch armed: `arm` starts it and returns how to stop it, or
 * throws; `arm`'s `failed` callback reports a watch that ended in an error.
 * Either way it is tried again after a growing pause, until stopped.
 */
export function keepArmed(arm: (failed: () => void) => () => void): () => void {
  let stopped = false;
  let close: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pause = FIRST_REARM_MS;
  const start = (): void => {
    timer = undefined;
    if (stopped) {
      return;
    }
    try {
      close = arm(retry);
      pause = FIRST_REARM_MS;
    } catch {
      retry();
    }
  };
  function retry(): void {
    close?.();
    close = undefined;
    if (stopped || timer) {
      return;
    }
    timer = setTimeout(start, pause);
    // A watch waiting to come back must not keep the process alive.
    timer.unref?.();
    pause = Math.min(pause * 2, MAX_REARM_MS);
  }
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    close?.();
  };
}

/**
 * Node reports the path that changed under a folder. macOS also reports the
 * watched folder itself, by its own name, which is dropped.
 */
function watchNatively(base: string, listener: Listener): () => void {
  return keepArmed((failed) => {
    const watcher = watch(base, { recursive: true }, (_event, name) => {
      if (name !== null && name.toString() !== path.basename(base)) {
        listener(name.toString().split(path.sep).join("/"));
      }
    });
    watcher.on("error", failed);
    return () => watcher.close();
  });
}

function watchFolderByFolder(base: string, listener: Listener): () => void {
  return keepArmed((failed) => {
    const tree = new FolderTree(base, listener, failed);
    tree.add(base, false);
    return () => tree.stop();
  });
}

/** One plain watcher per folder under `base`, kept in step with the folders. */
class FolderTree {
  private readonly watchers = new Map<string, FSWatcher>();
  private isStopped = false;

  constructor(
    private readonly base: string,
    private readonly listener: Listener,
    /** The base folder's own watch failed: the whole tree is armed again. */
    private readonly failed: () => void,
  ) {}

  stop(): void {
    this.isStopped = true;
    this.forget(this.base);
  }

  /** Watch `folder` and below; `announce` reports what is already inside. */
  add(folder: string, announce: boolean): void {
    if (this.isStopped || this.watchers.has(folder)) {
      return;
    }
    let watcher: FSWatcher;
    try {
      watcher = watch(folder, (event, name) => {
        this.onChange(folder, event, name);
      });
    } catch (error) {
      if (folder === this.base) {
        throw error;
      }
      return;
    }
    // A watched folder removed, or out of inotify watches: stop watching it.
    watcher.on("error", () =>
      folder === this.base ? this.failed() : this.forget(folder),
    );
    this.watchers.set(folder, watcher);
    void this.addChildren(folder, announce);
  }

  private async addChildren(folder: string, announce: boolean): Promise<void> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (this.isStopped) {
        return;
      }
      const child = path.join(folder, entry.name);
      if (announce) {
        this.report(child);
      }
      // A symbolic link is not entered: it could loop.
      if (entry.isDirectory() && !isIgnoredFolder(entry.name)) {
        this.add(child, announce);
      }
    }
  }

  private onChange(
    folder: string,
    event: string,
    name: string | Buffer | null,
  ): void {
    if (name === null || this.isStopped) {
      return;
    }
    const file = path.join(folder, name.toString());
    this.report(file);
    if (event !== "rename" || isIgnoredFolder(path.basename(file))) {
      return;
    }
    void this.followRename(file);
  }

  /** A name appeared or went: watch it if it is now a folder (not a link to one), else stop. */
  private async followRename(file: string): Promise<void> {
    const isFolder = await lstat(file).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (isFolder) {
      this.add(file, true);
    } else {
      this.forget(file);
    }
  }

  private forget(folder: string): void {
    for (const [watched, watcher] of this.watchers) {
      if (watched === folder || watched.startsWith(folder + path.sep)) {
        watcher.close();
        this.watchers.delete(watched);
      }
    }
  }

  private report(file: string): void {
    this.listener(path.relative(this.base, file).split(path.sep).join("/"));
  }
}
