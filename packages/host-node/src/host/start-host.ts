/**
 * Start Lumière's Markdown plugins outside VS Code, on any platform: the same
 * bootstrap VS Code runs, over the shared host services. Lumière's plugin
 * tree is its own (on its own Cordis); nothing from an embedder's plugin
 * context enters it. Node's entry is start.ts; a browser's is host-web.
 */
import { createRoot, type Logger, type RootContext } from "@workshop/core";
import {
  bootstrap,
  MARKDOWN_EDITOR,
  pluginRank,
  type ContributedSetting,
  type GitAccess,
  type HostServices,
  type HostSettings,
  type InkService,
} from "@workshop/markdown/portable";
import {
  createCommandPalette,
  type CommandContribution,
  type CommandPalette,
} from "./command-palette";
import {
  ContextKeys,
  registerContextMenus,
  type MenuContribution,
} from "./context-menu";
import { AUTOSAVE_DELAY_MS, NoteDocuments, noteFiles } from "./documents";
import {
  createFileOperations,
  type VaultFileOperations,
} from "./file-operations";
import { registerHistoryCommands } from "./history-commands";
import { CONNECT_TIMEOUT_MS, PanelHub } from "./panels";
import type { HostPlatform } from "./platform";
import {
  createHostCommands,
  createHostServices,
  type HostIdentity,
  type NodeHostCommands,
} from "./services";
import { servedDefaults, SETTINGS_FILE } from "./settings";
import { TreeHub } from "./trees";
import { uriName } from "./uris";
import { createHostVaultSystem } from "./vault";
import { createWorkspaceFiles, STATE_FILE } from "./workspace";

export interface HostStartOptions {
  readonly identity: HostIdentity;
  /** Lumière's settings and defaults, from the extension's `contributes`. */
  readonly contributed: readonly ContributedSetting[];
  /** Lumière's right-click menu items (`menus.json`, written at build time). */
  readonly menus?: readonly MenuContribution[];
  /** Lumière's Command Palette items (`commands.json`, written at build time). */
  readonly commands?: readonly CommandContribution[];
  readonly logger: Logger;
  /** Blame and the change gutter, when the platform provides Git. */
  readonly git?: (
    roots: () => readonly string[],
  ) => GitAccess & { dispose?(): void };
  /** A canvas to draw on, where the embedder has one (the iPad's PencilKit). */
  readonly ink?: InkService;
}

export interface LumiereHost {
  readonly panels: PanelHub;
  /** The plugins' tree views (Outline, Backlinks…), for the embedder to show. */
  readonly trees: TreeHub;
  /** Lumière's settings, for the embedder's settings page. */
  readonly settings: HostSettings;
  /** Lumière's Command Palette commands, filtered by active editor and settings. */
  readonly commands?: CommandPalette;
  /** New notes and folders, renames that update links, deletion (file-operations.ts). */
  readonly files: VaultFileOperations;
  /**
   * Trust a workspace: vaults are found inside it, and the pages of
   * `createEditorRoutes` open only from a folder inside one. The embedder
   * registers it, by its real path, before a page from it is requested; a page
   * cannot (docs/HOSTS_PLAN.md section 4).
   */
  addRoot(root: string): void;
  /**
   * Stop trusting a workspace the embedder closed (the app's closed vault):
   * no new page opens from it. Pages already open keep their notes.
   */
  removeRoot(root: string): void;
  /** Workspace roots already registered with `addRoot`. */
  workspaceRoots(): readonly string[];
  /**
   * Run one of the plugins' commands (`lumiere.markdown.*`), as a menu item
   * does: for the embedder's own menus, such as the iPad's edit menu.
   */
  run(command: string): Promise<unknown>;
  /**
   * Write every note with unsaved text now, without waiting for autosave:
   * for an embedder whose window can go away under the host (a browser tab
   * hidden or reloaded, the iPad app sent to the background).
   */
  saveAll(): Promise<void>;
  stop(): Promise<void>;
}

export async function startHost(
  platform: HostPlatform,
  options: HostStartOptions,
): Promise<LumiereHost> {
  const roots = new Set<string>();
  const rootList = () => [...roots];
  const log = (message: string) => options.logger.warn(message);
  const { documents, files } = createNotes(platform, rootList, log);
  const panels = new PanelHub(documents, CONNECT_TIMEOUT_MS, log);
  panels.followRenames((uri) => platform.files.toPath(uri));
  const keys = new ContextKeys();
  const commands = createHostCommands(log, keys);
  // The notes own undo here, as VS Code's TextDocuments do there.
  registerHistoryCommands(commands, panels, documents);
  const trees = new TreeHub(commands);
  const git = options.git?.(rootList);
  const { settings, root } = await bootstrapPlugins({
    platform,
    options,
    git,
    documents,
    panels,
    trees,
    commands,
    roots: rootList,
    log,
  });
  const stopMenus = registerContextMenus({
    panels,
    contributions: options.menus ?? [],
    keys,
    commands,
    viewType: MARKDOWN_EDITOR.viewType,
    log,
  });
  return {
    panels,
    trees,
    settings,
    commands: createCommandPalette({
      contributions: options.commands ?? [],
      keys,
      settings,
      panels,
      commands,
      viewType: MARKDOWN_EDITOR.viewType,
      log,
    }),
    files,
    addRoot: (item) => {
      roots.add(item.replace(/\/+$/, ""));
    },
    removeRoot: (item) => {
      roots.delete(item.replace(/\/+$/, ""));
    },
    workspaceRoots: () => [...roots],
    run: (command) => commands.execute(command),
    saveAll: () => documents.saveAll(),
    stop: () => stopHost({ stopMenus, panels, root, git, documents }),
  };
}

/**
 * The notes, and what the embedder's file tree does to files; renames move
 * files only inside the workspace roots.
 */
function createNotes(
  platform: HostPlatform,
  roots: () => readonly string[],
  log: (message: string) => void,
): { documents: NoteDocuments; files: VaultFileOperations } {
  const contained = createWorkspaceFiles(platform.files, roots);
  const documents = new NoteDocuments(
    { ...noteFiles(platform), move: (from, to) => contained.move(from, to) },
    AUTOSAVE_DELAY_MS,
    log,
  );
  const files = createFileOperations({
    files: platform.files,
    roots,
    documents,
  });
  return { documents, files };
}

async function bootstrapPlugins({
  platform,
  options,
  git,
  documents,
  panels,
  trees,
  commands,
  roots,
  log,
}: {
  readonly platform: HostPlatform;
  readonly options: HostStartOptions;
  readonly git: (GitAccess & { dispose?(): void }) | undefined;
  readonly documents: NoteDocuments;
  readonly panels: PanelHub;
  readonly trees: TreeHub;
  readonly commands: NodeHostCommands;
  readonly roots: () => readonly string[];
  readonly log: (message: string) => void;
}): Promise<{ readonly settings: HostSettings; readonly root: RootContext }> {
  const host = createHostServices({
    platform,
    commands,
    trees,
    identity: options.identity,
    documents,
    panels,
    roots,
    contributed: servedDefaults(options.contributed, git ? ["git"] : []),
    saved: await readSaved(platform),
    log,
    ...(git ? { git } : {}),
  });
  reportSaveFailures(documents, host.dialogs);
  const vault = createHostVaultSystem({
    platform,
    documents,
    settings: host.settings,
    roots,
    warn: log,
  });
  const root: RootContext = createRoot({
    rank: pluginRank,
    logger: options.logger,
  });
  await bootstrap(host, vault, root, options.ink ? { ink: options.ink } : {});
  return { settings: host.settings, root };
}

/** Pages and their menus first, then the plugins, then the notes. */
async function stopHost(parts: {
  readonly stopMenus: () => void;
  readonly panels: PanelHub;
  readonly root: RootContext;
  readonly git: { dispose?(): void } | undefined;
  readonly documents: NoteDocuments;
}): Promise<void> {
  parts.stopMenus();
  parts.panels.dispose();
  await parts.root.dispose();
  parts.git?.dispose?.();
  await parts.documents.dispose();
}

/** The reader's settings and the workspace state, as the store holds them. */
async function readSaved(platform: HostPlatform) {
  const [settings, state] = await Promise.all([
    platform.store.read(SETTINGS_FILE),
    platform.store.read(STATE_FILE),
  ]);
  return { settings, state };
}

/**
 * Tell the reader when a note could not be written (its text stays open),
 * and when their typing was written over another program's change (that
 * version is in a copy beside the note).
 */
function reportSaveFailures(
  documents: NoteDocuments,
  dialogs: Pick<HostServices["dialogs"], "error" | "inform">,
): void {
  documents.onConflict((uri, copy) =>
    dialogs.inform(
      `${uriName(uri)} changed on disk while you were typing. Your text was saved; the other version is in ${uriName(copy)}.`,
    ),
  );
  documents.onSaveFailed((uri, error) =>
    dialogs.error(
      `Lumière could not save ${uriName(uri)}: ${
        error instanceof Error ? error.message : String(error)
      }. Your text is still open; copy it somewhere safe.`,
    ),
  );
}
