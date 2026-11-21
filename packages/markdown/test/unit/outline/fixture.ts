import { provideHostServices } from "../../../src/shared/host";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import type { EditorPanel, Editors } from "../../../src/plugins/editor/api";
import { outlineHost } from "../../../src/plugins/outline/host";
import {
  COMMANDS_CONTEXT,
  EXPAND_MODE_SETTING,
  FOLLOW_CURSOR_CONTEXT,
  FOLLOW_CURSOR_SETTING,
  VIEW_ID,
} from "../../../src/plugins/outline/commands";
import type { TreeHandle, TreeNode } from "../../../src/shared/host";
import { fakeDocument, withHost } from "../../support/vscode-fake";
import { fakeViews, memoryVaults, uriOf, hostWith } from "../views/fakes";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function outlineFixture(
  notes: Record<string, string> = {
    "A.md": "# Title\nintro\n## Part\nbody\n",
  },
  {
    /**
     * VS Code's tree: a native collapse-all, and rows that stay open across
     * a refresh. Otherwise rows close one by one, and a refresh lays the
     * tree out again from the nodes' flags, as in the other hosts.
     */
    native = true,
    /**
     * Whether the tree can unselect a row, as VS Code's cannot.
     */
    clearsSelection = false,
  }: { native?: boolean; clearsSelection?: boolean } = {},
) {
  const fake = fakeViews();
  const { vaults, texts, opened } = memoryVaults(notes);
  const reveals: {
    node: TreeNode;
    options: Parameters<TreeHandle["reveal"]>[1];
  }[] = [];
  const expands: TreeNode[] = [];
  const collapses: TreeNode[] = [];
  let collapseAllCount = 0;
  let clearCount = 0;
  let refreshCount = 0;
  let expandHold: Promise<void> | undefined;
  let failNextExpand = false;
  // VS Code keeps a node open when refresh does not change collapsibleState.
  // Reveal-expand opens it visually; only expand() records the provider flag
  // that a later collapse can change.
  const providerExpanded = new Map<string, boolean>();
  const visuallyOpen = new Set<string>();
  const openLabels = new Map<string, string>();
  const providerFlag = (node: TreeNode) =>
    providerExpanded.has(node.id)
      ? providerExpanded.get(node.id) === true
      : node.expanded === true;
  const warnings: unknown[] = [];
  const informs: string[] = [];
  /** The Links plugin's switch for every note, as `settings.forNote` reports it. */
  const links = { enabled: true };
  const settingsWrites: unknown[][] = [];
  const resources = new Map<string, boolean>();
  const contexts = new Map<string, unknown>();
  const executed: unknown[][] = [];
  const panels: EditorPanel[] = [];
  let active: EditorPanel | undefined;
  let visible = true;
  let configure = () => {};
  // As VS Code's tree view: any number of listeners, each its own subscription.
  const visibilityListeners = new Set<(visible: boolean) => void>();
  let treeOptions: Parameters<typeof fake.views.tree>[2];
  const originalTree = fake.views.tree;
  fake.views.tree = (id, source, options) => {
    treeOptions = options;
    const base = originalTree(id, source, options);
    const originalRefresh = base.refresh.bind(base);
    return {
      ...base,
      refresh() {
        refreshCount++;
        if (!native) {
          visuallyOpen.clear();
          providerExpanded.clear();
        }
        originalRefresh();
      },
      async reveal(node, options) {
        reveals.push({ node, options });
        openLabels.set(node.id, node.label);
        if (options?.expand) {
          visuallyOpen.add(node.id);
        }
      },
      async expand(node) {
        if (failNextExpand) {
          failNextExpand = false;
          throw new Error("expand failed");
        }
        await expandHold;
        expands.push(node);
        openLabels.set(node.id, node.label);
        providerExpanded.set(node.id, true);
        visuallyOpen.add(node.id);
      },
      async collapse(node) {
        collapses.push(node);
        openLabels.set(node.id, node.label);
        const wasExpanded = providerFlag(node);
        providerExpanded.set(node.id, false);
        if (wasExpanded) {
          visuallyOpen.delete(node.id);
        }
      },
      ...(clearsSelection && {
        async clearSelection() {
          clearCount++;
        },
      }),
      ...(native && {
        async collapseAll() {
          collapseAllCount++;
          visuallyOpen.clear();
          providerExpanded.clear();
        },
        keepsExpansion: true,
      }),
      get visible() {
        return visible;
      },
      onVisibilityChanged(listener) {
        visibilityListeners.add(listener);
        return () => {
          visibilityListeners.delete(listener);
        };
      },
    };
  };
  // Tests replace the fake's dialogs member by member: keep that object.
  fake.dialogs.inform = (message) => {
    informs.push(message);
  };
  const host = withHost(hostWith(fake), {
    hostCommands: {
      execute: async (command, key, value) => {
        executed.push(
          [command, key, value].filter((part) => part !== undefined),
        );
        if (command === "setContext") {
          contexts.set(String(key), value);
        }
      },
    },
    settings: {
      forNote: () => ({
        preset: "obsidian",
        mode: "livePreview",
        features: { links: { enabled: links.enabled, config: {} } },
      }),
      onChange: (listener) => {
        configure = listener;
        return () => {
          configure = () => {};
        };
      },
      access: {
        inspect(key, resource) {
          if (key === EXPAND_MODE_SETTING) {
            return {
              value: fake.settings[key] ?? "accordion",
              target: "user" as const,
            };
          }
          assert.equal(key, FOLLOW_CURSOR_SETTING);
          return {
            value:
              (resource && resources.get(resource)) ??
              fake.settings[key] ??
              true,
            target: "user" as const,
          };
        },
        async update(key, value, resource) {
          settingsWrites.push([key, value, resource]);
          if (resource && resources.has(resource)) {
            resources.set(resource, Boolean(value));
          } else {
            fake.settings[key] = value;
          }
          configure();
          return "user";
        },
        searchFilter: "@ext:test.lumiere",
        contributed: () => [],
        openUi: async () => {},
      },
    },
  });
  const editors: Editors = {
    all: () => panels,
    active: () => active,
    capture: async () => {
      throw new Error("unused");
    },
    restore: async () => {},
  };
  const root = createRoot({
    logger: {
      debug() {},
      error: (_message, error) => {
        warnings.push(error);
      },
      warn: (_message, error) => {
        warnings.push(error);
      },
    },
  });
  provideHostServices(root, host);
  root.provide("vaults", vaults);
  root.provide("editors", editors);
  root.plugin(outlineHost);
  await root.settled();
  await tick();
  return {
    root,
    fake,
    vaults,
    texts,
    opened,
    informs,
    links,
    reveals,
    expands,
    collapses,
    get refreshCount() {
      return refreshCount;
    },
    get collapseAllCount() {
      return collapseAllCount;
    },
    /** How many times the tree was told to unselect its row. */
    get clearCount() {
      return clearCount;
    },
    /** Hold every expand of the tree until the returned function runs. */
    holdExpands(): () => void {
      const gate = deferred<void>();
      expandHold = gate.promise;
      return () => {
        expandHold = undefined;
        gate.resolve();
      };
    },
    /** Make the tree's next expand fail. */
    failNextExpand(): void {
      failNextExpand = true;
    },
    isOpen(label: string) {
      for (const id of visuallyOpen) {
        if (openLabels.get(id) === label) {
          return true;
        }
      }
      return false;
    },
    warnings,
    resources,
    settingsWrites,
    executed,
    view: fake.trees.get(VIEW_ID)!,
    get treeOptions() {
      return treeOptions;
    },
    get followsCursor() {
      return contexts.get(FOLLOW_CURSOR_CONTEXT);
    },
    get commandsAvailable() {
      return contexts.get(COMMANDS_CONTEXT);
    },
    configure,
    panel(id: string, path = "A.md", head = 0) {
      const notifications = new Map<string, Set<(params: unknown) => void>>();
      const cursor = {
        /** As the webview reports a scroll: where the reader is now. */
        read(offset: number, version?: number): void {
          for (const run of notifications.get("outline.readingPosition") ??
            []) {
            run({ offset, version: version ?? cursor.version });
          }
        },
        get listeners(): number {
          return notifications.get("outline.readingPosition")?.size ?? 0;
        },
        head,
        version: 0,
        documentVersion: 1,
        calls: 0,
        capture: (): Promise<{ head: number; version: number }> =>
          Promise.resolve({ head: cursor.head, version: cursor.version }),
      };
      const panel = {
        id,
        document: {
          ...fakeDocument({
            uri: uriOf(path),
            getText: () => texts.get(path) ?? "",
          }),
          get version() {
            return cursor.documentVersion;
          },
        },
        session: {
          get document() {
            return panel.document;
          },
          get version() {
            return cursor.version;
          },
        },
        rpc: {
          async call(_protocol: unknown, method: string) {
            assert.equal(method, "captureCursor");
            cursor.calls++;
            return cursor.capture();
          },
          on(
            protocol: { id: string },
            method: string,
            run: (params: unknown) => void,
          ) {
            const key = `${protocol.id}.${method}`;
            const set = notifications.get(key) ?? new Set();
            set.add(run);
            notifications.set(key, set);
            return () => set.delete(run);
          },
        },
      } as unknown as EditorPanel;
      panels.push(panel);
      return { panel, cursor };
    },
    open(panel: EditorPanel) {
      active = panel;
      root.emit("editor/opened", panel);
    },
    switchTo(panel: EditorPanel | undefined) {
      active = panel;
      root.emit("editor/activeChanged", panel);
    },
    show(isVisible: boolean) {
      visible = isVisible;
      for (const listener of [...visibilityListeners]) {
        listener(isVisible);
      }
    },
  };
}
