/**
 * VS Code's workspace services outside VS Code, over the host's platform
 * (platform.ts): the workspaces notes were opened from, file operations, and
 * small persistent state. Every path is checked against the roots first.
 */
import type {
  Extensions,
  HostWorkspace,
  WorkerLauncher,
  WorkspaceFiles,
  WorkspaceStorage,
} from "@workshop/markdown/portable";
import { containInRoots, type HostFiles, type HostStore } from "./platform";
import { parentUri } from "./uris";

/** VS Code's workspace state, in the host's store. */
export const STATE_FILE = "state.json";

export interface HostWorkspaceOptions {
  readonly files: HostFiles;
  /** The workspace roots, as file URIs. */
  readonly roots: () => readonly string[];
}

export function createHostWorkspace({
  files,
  roots,
}: HostWorkspaceOptions): HostWorkspace {
  const inside = (uri: string) => containInRoots(files, roots(), uri);
  return {
    folders: roots,
    // The host runs only what its owner installed and opened.
    isTrusted: () => true,
    read: async (uri) => files.readBytes(uri, await inside(uri)),
    stat: async (uri) => {
      await inside(uri);
      const info = await files.linkStat(uri);
      if (!info) {
        throw Object.assign(new Error(`No file at ${uri}`), {
          code: "FileNotFound",
        });
      }
      return info;
    },
    ...(files.realContains
      ? {
          realContains: (root: string, uri: string) =>
            files.realContains!(root, uri),
        }
      : {}),
    watch: (uri, listener) => watchContained(inside, files, uri, listener),
    files: createWorkspaceFiles(files, roots),
    revealTextEditor: async () => {},
  };
}

export function createWorkspaceFiles(
  files: HostFiles,
  roots: () => readonly string[],
): WorkspaceFiles {
  const inside = (uri: string) => containInRoots(files, roots(), uri);
  return {
    authorize: (root, target) => files.contain(root, target),
    ...workspaceFileReads(files, inside),
    ...workspaceFileWrites(files, inside),
    // There is no native file picker behind a page.
    pickFile: async () => undefined,
  };
}

function workspaceFileReads(
  files: HostFiles,
  inside: (uri: string) => Promise<string>,
): Pick<WorkspaceFiles, "readText" | "list" | "isSymbolicLink"> {
  return {
    readText: async (uri) => {
      try {
        return await files.readText(uri, await inside(uri));
      } catch {
        return undefined;
      }
    },
    list: async (uri) => {
      try {
        await inside(uri);
      } catch {
        return undefined;
      }
      return (await files.list(uri))?.map((entry) => entry.name);
    },
    isSymbolicLink: async (uri) => {
      try {
        await inside(uri);
      } catch {
        return false;
      }
      return (await files.linkStat(uri))?.symbolicLink ?? false;
    },
  };
}

/**
 * What a write does before it fills a file: check, make the parent folders,
 * check again, create. Each step yields the root the file must stay in, which
 * the write passes on so the platform verifies the file it opens.
 */
function containedWrites(
  files: HostFiles,
  inside: (uri: string) => Promise<string>,
) {
  // The parent folders, then the check again: a folder swapped for a link
  // after the first check would have had them made outside.
  const prepareParent = async (uri: string) => {
    const root = await inside(uri);
    await files.mkdir(parentUri(files, uri));
    await inside(uri);
    return root;
  };
  // `save` / `saveBytes` only replace; `create` leaves an existing file as-is.
  const prepareWrite = async (uri: string) => {
    const root = await prepareParent(uri);
    return { root, isCreated: await files.create(uri, root) };
  };
  // Only the writer that made the file fills it.
  const createFilled = async (
    uri: string,
    fill: (root: string) => Promise<void>,
  ) => {
    const { root, isCreated } = await prepareWrite(uri);
    if (!isCreated) {
      return false;
    }
    await fill(root);
    return true;
  };
  return { prepareWrite, createFilled };
}

function workspaceFileWrites(
  files: HostFiles,
  inside: (uri: string) => Promise<string>,
): Pick<
  WorkspaceFiles,
  | "writeText"
  | "createText"
  | "writeBytes"
  | "createBytes"
  | "mkdir"
  | "copy"
  | "move"
  | "remove"
> {
  const { prepareWrite, createFilled } = containedWrites(files, inside);
  return {
    writeText: async (uri, text) => {
      const { root } = await prepareWrite(uri);
      await files.save(uri, text, root);
    },
    createText: (uri, text) =>
      createFilled(uri, (root) => files.save(uri, text, root)),
    writeBytes: async (uri, data) => {
      const { root } = await prepareWrite(uri);
      await files.saveBytes(uri, data, root);
    },
    createBytes: (uri, data) =>
      createFilled(uri, (root) => files.saveBytes(uri, data, root)),
    mkdir: async (uri) => {
      await inside(uri);
      await files.mkdir(uri);
    },
    copy: async (from, to) => {
      await Promise.all([inside(from), inside(to)]);
      await files.copy(from, to);
    },
    move: async (from, to) => {
      await Promise.all([inside(from), inside(to)]);
      await files.mkdir(parentUri(files, to));
      await files.move(from, to);
    },
    remove: async (uri) => {
      await inside(uri);
      await files.remove(uri);
    },
  };
}

/**
 * Small state kept in one JSON file (VS Code's workspace state). `saved` is
 * what the store held at start (`STATE_FILE`).
 */
export function createWorkspaceStorage(
  store: HostStore,
  saved: string | undefined,
): WorkspaceStorage {
  let values = readValues(saved);
  let writing: Promise<void> = Promise.resolve();
  return {
    get: <T>(key: string, fallback: T): T =>
      key in values ? (values[key] as T) : fallback,
    update: (key, value) => {
      const job = writing.then(async () => {
        values = { ...values, [key]: value };
        await store.write(STATE_FILE, JSON.stringify(values));
      });
      writing = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  };
}

/** Watch a file only after it is known to sit inside a workspace. */
function watchContained(
  inside: (uri: string) => Promise<unknown>,
  files: HostFiles,
  uri: string,
  listener: () => void,
): () => void {
  let close = (): void => {};
  let stopped = false;
  void inside(uri)
    .then(() => {
      if (stopped) {
        return;
      }
      // The file, or folders above it, may not exist yet.
      close = files.watch(uri, listener);
    })
    .catch(() => {
      // Outside the workspace, or gone: there is nothing to watch.
    });
  return () => {
    stopped = true;
    close();
  };
}

function readValues(text: string | undefined): Record<string, unknown> {
  if (text === undefined) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** No other extensions run beside Lumière outside VS Code. */
export function createExtensions(workers: WorkerLauncher): Extensions {
  return { isInstalled: () => false, workers };
}
