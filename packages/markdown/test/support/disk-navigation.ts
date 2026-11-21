import Module, { createRequire } from "node:module";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as HostNavigation from "../../src/host/navigation";
import type { Configuration } from "../../src/shared/configuration";
import { forgetModules } from "./module-cache";

/**
 * Load `host/navigation` against the test's own `vscode` fake. Each test
 * brings its own fake, so the host modules are loaded again for it.
 */
export function loadNavigation(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    return require("../../src/host/navigation.ts") as typeof HostNavigation;
  } finally {
    loader._load = originalLoad;
  }
}

/** Settings that read as their defaults, with nothing to prepare. */
const defaultSettings = {
  get: (_key: string, fallback: unknown) => fallback,
  prepare: async () => {},
} as unknown as Configuration;

/**
 * The real navigation (`host/navigation.ts`, which resolves, makes and opens
 * notes) over a `vscode` fake whose file system is the real disk, so a test
 * can resolve and create links in a temporary vault.
 */
export function diskNavigation(
  options: {
    /** Settings, which read as their defaults when absent. */
    configuration?: Configuration;
    /** Told the path of each file system `stat`, to count the places asked. */
    onStat?: (fsPath: string) => void;
  } = {},
) {
  const { configuration = defaultSettings, onStat } = options;
  class FileSystemError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  function fileUri(fsPath: string) {
    const href = pathToFileURL(fsPath).href;
    const url = new URL(href);
    return {
      scheme: url.protocol.slice(0, -1),
      authority: url.host,
      path: decodeURIComponent(url.pathname),
      fsPath,
      toString: () => href,
      with({ path: next }: { path: string }) {
        // `next` is a URI path (/C:/... on Windows), not a file system path.
        const moved = new URL(href);
        moved.pathname = next;
        return fileUri(fileURLToPath(moved));
      },
    };
  }
  type Uri = ReturnType<typeof fileUri>;
  class WorkspaceEdit {
    creates: Uri[] = [];
    createFile(uri: Uri) {
      this.creates.push(uri);
    }
  }
  const { createNavigation } = loadNavigation({
    Uri: {
      parse: (value: string) => fileUri(fileURLToPath(value)),
      joinPath: (base: Uri, ...parts: string[]) =>
        fileUri(join(base.fsPath, ...parts)),
    },
    WorkspaceEdit,
    FileSystemError,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    env: { appName: "Cursor", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      getConfiguration: () => ({ get: () => "on" }),
      fs: {
        async stat(uri: Uri) {
          onStat?.(uri.fsPath);
          try {
            await access(uri.fsPath);
            return { type: 1 };
          } catch {
            throw new FileSystemError("missing", "FileNotFound");
          }
        },
      },
      async applyEdit(edit: WorkspaceEdit) {
        for (const uri of edit.creates) {
          await mkdir(join(uri.fsPath, ".."), { recursive: true });
          await writeFile(uri.fsPath, "");
        }
        return true;
      },
    },
    commands: { async executeCommand() {} },
  });
  return createNavigation(() => [], configuration);
}
