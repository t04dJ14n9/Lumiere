/**
 * Watching a folder and everything under it (platform.ts `watchTree`).
 *
 * Node's recursive `fs.watch` is native on macOS and Windows. On Linux it is
 * JavaScript: when a subfolder appears it reads it synchronously inside the
 * change handler, and if the folder is already gone (git, sync tools and
 * editors create and remove folders quickly) the read throws there. That
 * escapes as an uncaught exception, never to `watcher.on("error")`, and
 * ends the server. So on Linux each folder gets its own plain watcher,
 * added and removed here, every step guarded.
 */
import { lstatSync, readdirSync, watch, type FSWatcher } from "node:fs";
import * as path from "node:path";

type Listener = (relative: string) => void;

export function watchTree(
  base: string,
  listener: Listener,
  platform: NodeJS.Platform = process.platform,
): () => void {
  return platform === "linux"
    ? watchFolderByFolder(base, listener)
    : watchNatively(base, listener);
}

/**
 * Node reports the path that changed under a folder. macOS also reports the
 * watched folder itself, by its own name, which is dropped.
 */
function watchNatively(base: string, listener: Listener): () => void {
  const watcher = watch(base, { recursive: true }, (_event, name) => {
    if (name !== null && name.toString() !== path.basename(base)) {
      listener(name.toString().split(path.sep).join("/"));
    }
  });
  watcher.on("error", () => watcher.close());
  return () => watcher.close();
}

function watchFolderByFolder(base: string, listener: Listener): () => void {
  const tree = new FolderTree(base, listener);
  tree.add(base, false);
  return () => tree.stop();
}

/** One plain watcher per folder under `base`, kept in step with the folders. */
class FolderTree {
  private readonly watchers = new Map<string, FSWatcher>();
  private isStopped = false;

  constructor(
    private readonly base: string,
    private readonly listener: Listener,
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
    } catch {
      return;
    }
    // A watched folder removed, or out of inotify watches: stop watching it.
    watcher.on("error", () => this.forget(folder));
    this.watchers.set(folder, watcher);
    this.addChildren(folder, announce);
  }

  private addChildren(folder: string, announce: boolean): void {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return;
    }
    for (const name of names) {
      const child = path.join(folder, name);
      if (announce) {
        this.report(child);
      }
      if (isFolder(child)) {
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
    if (event !== "rename") {
      return;
    }
    if (isFolder(file)) {
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

function isFolder(file: string): boolean {
  try {
    return lstatSync(file).isDirectory();
  } catch {
    return false;
  }
}
