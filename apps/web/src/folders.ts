/**
 * Vaults the reader keeps in the browser: folders picked with the File
 * System Access API (Chromium), remembered between visits in IndexedDB, and
 * vaults kept in the browser's private storage (every browser). Each is
 * mounted in host-web at `/vaults/<name>`, a name no other vault has.
 */
import type { Mounts } from "@workshop/host-web";
import { HandleFileSystem } from "./handle-fs";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

const DATABASE = "lumiere";
const FOLDERS = "folders";
const VAULTS = "/vaults/";

/**
 * Picked folders kept between visits, by the name of the vault each is
 * mounted as (earlier visits kept them by the folder's own name, which is the
 * same for a folder whose name no other vault had).
 */
export interface FolderStore {
  put(name: string, handle: FileSystemDirectoryHandle): Promise<void>;
  all(): Promise<readonly (readonly [string, FileSystemDirectoryHandle])[]>;
}

/** Whether the reader can pick a folder of their own (not in Safari or Firefox). */
export function canPickFolders(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

/** The folders the reader picked, mounted in `files`. */
export class PickedFolders {
  /** Each picked folder, by the vault path it is mounted at. */
  private readonly picked = new Map<string, FileSystemDirectoryHandle>();

  constructor(
    private readonly files: Mounts,
    private readonly store: FolderStore = browserFolderStore(),
  ) {}

  /** Let the reader pick a folder, mount it, remember it; its vault path. */
  async pick(): Promise<string | undefined> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker!({
        mode: "readwrite",
        id: "lumiere",
      });
    } catch {
      return undefined; // The reader cancelled.
    }
    return this.add(handle);
  }

  /**
   * Mount a folder the reader picked and remember it. The same folder
   * picked again keeps its path; another of the same name gets a number
   * after it, as two vaults of one name do on the iPad.
   */
  async add(handle: FileSystemDirectoryHandle): Promise<string> {
    const known = await this.pathOf(handle);
    if (known) {
      return known;
    }
    const path = freeVaultPath(handle.name, (taken) =>
      this.files.isMounted(taken),
    );
    this.mount(path, handle);
    await this.store.put(path.slice(VAULTS.length), handle);
    return path;
  }

  /** Mount the folders picked on earlier visits that the browser still lets us read. */
  async mountRemembered(): Promise<void> {
    for (const [name, handle] of await this.store.all()) {
      const path = `${VAULTS}${safeName(name)}`;
      const permission = await handle
        .queryPermission?.({ mode: "readwrite" })
        .catch(() => "denied");
      if (permission === "granted" && !this.files.isMounted(path)) {
        this.mount(path, handle);
      }
    }
  }

  private mount(path: string, handle: FileSystemDirectoryHandle): void {
    this.files.mount(path, new HandleFileSystem(handle));
    this.picked.set(path, handle);
  }

  private async pathOf(
    handle: FileSystemDirectoryHandle,
  ): Promise<string | undefined> {
    for (const [path, other] of this.picked) {
      if (await other.isSameEntry(handle).catch(() => false)) {
        return path;
      }
    }
    return undefined;
  }
}

/** `/vaults/<name>`, or `/vaults/<name> 2` and on while that is taken. */
export function freeVaultPath(
  name: string,
  isTaken: (path: string) => boolean,
): string {
  const base = `${VAULTS}${safeName(name)}`;
  let path = base;
  for (let n = 2; isTaken(path); n++) {
    path = `${base} ${n}`;
  }
  return path;
}

/** The browser's private storage, or undefined where it has none. */
export async function privateFolder(
  name: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(name, { create: true });
  } catch {
    return undefined;
  }
}

function safeName(name: string): string {
  return name.replace(/[/\\]/g, "-") || "Folder";
}

/** Picked folders kept in IndexedDB, which can hold a folder's handle. */
function browserFolderStore(): FolderStore {
  return {
    put: async (name, handle) => {
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const put = db
          .transaction(FOLDERS, "readwrite")
          .objectStore(FOLDERS)
          .put(handle, name);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      });
    },
    all: () => remembered().catch(() => []),
  };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FOLDERS);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function remembered(): Promise<
  (readonly [string, FileSystemDirectoryHandle])[]
> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const folders: (readonly [string, FileSystemDirectoryHandle])[] = [];
    const cursor = db.transaction(FOLDERS).objectStore(FOLDERS).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve(folders);
        return;
      }
      folders.push([
        String(current.key),
        current.value as FileSystemDirectoryHandle,
      ]);
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor: {
      mode: "read" | "readwrite";
    }): Promise<PermissionState>;
  }
}
