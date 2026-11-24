/**
 * Just enough of the VS Code API for the extension's plugins to activate in
 * unit tests, with every registration tracked: anything a plugin registers
 * (commands, editors, views, status items, listeners, watchers, MCP
 * providers) stays in `outstanding()` until it is disposed. See
 * `install-fake-vscode.ts`, which makes `import 'vscode'` load this file.
 */
import * as path from "node:path";

type Listener = (value: unknown) => unknown;

const live = new Map<object, string>();

/** Registrations not disposed yet, by kind. */
export function outstanding(): string[] {
  return [...live.values()].sort();
}

/** Forget every registration (after a test that leaks on purpose). */
export function forgetAll(): void {
  live.clear();
}

/** Context keys set with `setContext`, and configuration the fake returns. */
export const contextKeys = new Map<string, unknown>();
export const configuration = new Map<string, unknown>();

export class Disposable {
  static from(...items: ({ dispose(): unknown } | undefined)[]): Disposable {
    return new Disposable(() => {
      for (const item of items) {
        item?.dispose();
      }
    });
  }
  constructor(private callOnDispose?: () => unknown) {}
  dispose(): void {
    const call = this.callOnDispose;
    this.callOnDispose = undefined;
    call?.();
  }
}

function track<T extends object>(
  kind: string,
  value: T = {} as T,
): T & Disposable {
  const handle = Object.assign(value, {
    dispose: () => {
      live.delete(handle);
    },
  });
  live.set(handle, kind);
  return handle as T & Disposable;
}

/** An event whose subscriptions are tracked as `listener:<name>`. */
function event(name: string) {
  return (_listener: Listener) => track(`listener:${name}`);
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => unknown>();
  readonly event = (listener: (value: T) => unknown): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fragment = "",
    readonly authority = "",
  ) {}
  static file(path: string): Uri {
    // As VS Code's: separators are slashes, and a Windows drive letter
    // follows a slash (`C:\x` is the path `/C:/x`).
    const slashed = path.replaceAll("\\", "/");
    return new Uri(
      "file",
      /^[A-Za-z]:/u.test(slashed) ? `/${slashed}` : slashed,
    );
  }
  static parse(value: string): Uri {
    // The scheme ends at the first colon; a Windows drive (`/C:/x`) has one too.
    const colon = value.indexOf(":");
    const scheme = colon < 0 ? value : value.slice(0, colon);
    const rest = colon < 0 ? "" : value.slice(colon + 1);
    const hash = rest.indexOf("#");
    const path = hash < 0 ? rest : rest.slice(0, hash);
    return new Uri(
      scheme,
      decodeURIComponent(path.replace(/^\/\//u, "")),
      hash < 0 ? "" : rest.slice(hash + 1),
      /^\/\/([^/]*)/u.exec(path)?.[1] ?? "",
    );
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    // As VS Code's: `..` and repeated separators are resolved.
    return new Uri(
      base.scheme,
      path.posix.join(base.path, ...parts),
      "",
      base.authority,
    );
  }
  with(change: { fragment?: string }): Uri {
    return new Uri(
      this.scheme,
      this.path,
      change.fragment ?? this.fragment,
      this.authority,
    );
  }
  get fsPath(): string {
    // As VS Code's: on Windows, `/C:/x` is `c:\x`.
    if (process.platform === "win32" && /^\/[A-Za-z]:/u.test(this.path)) {
      return `${this.path.charAt(1).toLowerCase()}${this.path.slice(2)}`.replaceAll(
        "/",
        "\\",
      );
    }
    return this.path;
  }
  toString(): string {
    return `${this.scheme}://${this.path}${this.fragment ? `#${this.fragment}` : ""}`;
  }
}

export class FileSystemError extends Error {
  constructor(
    message: string,
    readonly code = "Unknown",
  ) {
    super(message);
  }
  static FileNotFound(message = ""): FileSystemError {
    return new FileSystemError(message, "FileNotFound");
  }
}

export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}
export class TreeItem {
  constructor(
    readonly label: string,
    readonly collapsibleState?: number,
  ) {}
}
export class ThemeIcon {
  constructor(readonly id: string) {}
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ConfigurationTarget = { Global: 1, Workspace: 2 };
export const ViewColumn = { Active: -1, Beside: -2, One: 1 };
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

export const commands = {
  registerCommand: (id: string) => track(`command:${id}`),
  executeCommand: async (id: string, ...args: unknown[]) => {
    if (id === "setContext") {
      contextKeys.set(String(args[0]), args[1]);
    }
    return undefined;
  },
  getCommands: async () => [] as string[],
};

export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

export const window = {
  activeColorTheme: { kind: ColorThemeKind.Dark },
  onDidChangeActiveColorTheme: event("window.colorTheme"),
  setStatusBarMessage: (_text: string, _hideAfterTimeout?: number) =>
    track("statusBarMessage", { dispose() {} }),
  registerCustomEditorProvider: (viewType: string) =>
    track(`customEditor:${viewType}`),
  createStatusBarItem: () =>
    track("statusBarItem", {
      name: "",
      text: "",
      tooltip: "",
      command: undefined as unknown,
      show() {},
      hide() {},
    }),
  createTreeView: (id: string) =>
    track(`treeView:${id}`, {
      visible: false,
      message: undefined as string | undefined,
      onDidChangeVisibility: event("treeView.visibility"),
      reveal: async () => undefined,
    }),
  createOutputChannel: () =>
    track("outputChannel", {
      info() {},
      warn() {},
      error() {},
      appendLine() {},
    }),
  showInformationMessage: async (_message: string) => undefined,
  showWarningMessage: async (_message: string) => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  tabGroups: {
    all: [] as unknown[],
    onDidChangeTabs: event("tabGroups.tabs"),
    onDidChangeTabGroups: event("tabGroups.groups"),
  },
};

const workspaceFoldersChanged = new Set<Listener>();
const trustGranted = new Set<Listener>();

/** Change the window's workspace folders, as Add Folder to Workspace does. */
export function setWorkspaceFolders(folders: Uri[]): void {
  workspace.workspaceFolders = folders.map((uri) => ({ uri }));
  for (const listener of [...workspaceFoldersChanged]) {
    listener({ added: [], removed: [] });
  }
}

/** Trust the window's folders, as the Trust dialog does: a grant fires onDidGrantWorkspaceTrust. */
export function setWorkspaceTrusted(trusted: boolean): void {
  workspace.isTrusted = trusted;
  if (trusted) {
    for (const listener of [...trustGranted]) {
      listener(undefined);
    }
  }
}

export const workspace = {
  workspaceFolders: undefined as { uri: Uri }[] | undefined,
  isTrusted: true,
  onDidGrantWorkspaceTrust: (listener: Listener) => {
    trustGranted.add(listener);
    const handle = track("listener:workspace.trust");
    return new Disposable(() => {
      trustGranted.delete(listener);
      handle.dispose();
    });
  },
  onDidChangeWorkspaceFolders: (listener: Listener) => {
    workspaceFoldersChanged.add(listener);
    const handle = track("listener:workspace.workspaceFolders");
    return new Disposable(() => {
      workspaceFoldersChanged.delete(listener);
      handle.dispose();
    });
  },
  getConfiguration: (section = "") => ({
    get: <T>(key: string, fallback?: T) =>
      (configuration.has(`${section}.${key}`)
        ? configuration.get(`${section}.${key}`)
        : fallback) as T,
    update: async (key: string, value: unknown) => {
      configuration.set(`${section}.${key}`, value);
    },
  }),
  onDidChangeConfiguration: event("workspace.configuration"),
  onDidSaveTextDocument: event("workspace.saveTextDocument"),
  findFiles: async (_include?: unknown, _exclude?: unknown) => [] as Uri[],
  createFileSystemWatcher: () =>
    track("fileSystemWatcher", {
      onDidChange: event("watcher.change"),
      onDidCreate: event("watcher.create"),
      onDidDelete: event("watcher.delete"),
    }),
  asRelativePath: (value: unknown) => String(value),
  getWorkspaceFolder: (uri: Uri) =>
    workspace.workspaceFolders?.find(
      (folder) =>
        uri.path === folder.uri.path ||
        uri.path.startsWith(`${folder.uri.path}/`),
    ),
  fs: {
    readFile: async () => new Uint8Array(),
    stat: async () => ({ size: 0 }),
  },
};

export const env = {
  appName: "Visual Studio Code",
  clipboard: {
    readText: async () => "",
    writeText: async (_text: string) => undefined,
  },
  openExternal: async () => true,
};

export const extensions = {
  all: [] as { packageJSON: unknown }[],
  getExtension: (_id: string) => undefined,
};

/** Cursor's own API; `mcp` is set by the tests that run as Cursor. */
export const cursor: {
  mcp?: {
    registerServer(config: unknown): void;
    unregisterServer(name: string): void;
  };
} = {};

export const lm = {
  registerMcpServerDefinitionProvider: (id: string) =>
    track(`mcpProvider:${id}`),
};

export class McpHttpServerDefinition {
  constructor(
    readonly label: string,
    readonly uri: Uri,
    readonly headers: Record<string, string> = {},
  ) {}
}

export const languages = {
  registerDocumentLinkProvider: () => track("documentLinkProvider"),
};
