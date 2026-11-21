import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";
import type * as PanelAdapter from "../../../src/host/panel-adapter";
import { forgetModules } from "../../support/module-cache";

interface FakePanel {
  viewType: string;
  title: string;
  column: number;
  options: {
    enableScripts: boolean;
    enableCommandUris?: boolean;
    retainContextWhenHidden: boolean;
    localResourceRoots: { toString(): string }[];
  };
  revealed: number[];
  disposed: boolean;
  dispose(): void;
  reveal(column: number): void;
  onDidDispose(listener: () => void): { dispose(): void };
  onDidChangeViewState(): { dispose(): void };
  title_: string;
  /** Message handlers registered on the page's webview. */
  messageHandlers: number;
  webview: {
    cspSource: string;
    html: string;
    asWebviewUri(uri: { toString(): string }): { toString(): string };
    postMessage(message: unknown): Promise<boolean>;
    onDidReceiveMessage(): { dispose(): void };
  };
}

function load() {
  const panels: FakePanel[] = [];
  const uri = (text: string) => ({ toString: () => text });
  const vscode = {
    ViewColumn: { Active: -1, Beside: -2 },
    Uri: {
      parse: (text: string) => uri(text),
      joinPath: (base: { toString(): string }, ...parts: string[]) =>
        uri([base.toString(), ...parts].join("/")),
    },
    window: {
      createWebviewPanel(
        viewType: string,
        title: string,
        column: number,
        options: FakePanel["options"],
      ) {
        const listeners: (() => void)[] = [];
        const panel: FakePanel = {
          viewType,
          title,
          column,
          options,
          revealed: [],
          messageHandlers: 0,
          disposed: false,
          title_: title,
          dispose() {
            panel.disposed = true;
            listeners.forEach((listener) => listener());
          },
          reveal: (to) => panel.revealed.push(to),
          onDidDispose(listener) {
            listeners.push(listener);
            return { dispose() {} };
          },
          onDidChangeViewState: () => ({ dispose() {} }),
          webview: {
            cspSource: "https://*.vscode-cdn.net",
            html: "",
            asWebviewUri: (target) =>
              uri(`https://webview.test/${target.toString()}`),
            postMessage: async () => true,
            onDidReceiveMessage: () => {
              panel.messageHandlers += 1;
              return { dispose() {} };
            },
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    const adapter =
      require("../../../src/host/panel-adapter.ts") as typeof PanelAdapter;
    return { adapter, panels, uri };
  } finally {
    loader._load = originalLoad;
  }
}

test("a panel with no options is as it was: one per view type, only the extension's files", () => {
  const { adapter, panels, uri } = load();
  const open = adapter.createLumierePanel(uri("ext") as never);
  open("graph", "Vault Graph");
  open("graph", "Vault Graph");
  assert.equal(panels.length, 1);
  assert.deepEqual(panels[0]!.revealed, [-1]);
  assert.equal(panels[0]!.column, -1);
  assert.equal(panels[0]!.options.retainContextWhenHidden, false);
  assert.deepEqual(panels[0]!.options.localResourceRoots.map(String), [
    "ext/dist/markdown",
  ]);
});

test("panels of one view type are told apart by key, and a closed one is made again", () => {
  const { adapter, panels, uri } = load();
  const open = adapter.createLumierePanel(uri("ext") as never);
  open("viewer", "a.html", { key: "file:///a.html" });
  open("viewer", "b.html", { key: "file:///b.html" });
  open("viewer", "a.html", { key: "file:///a.html" });
  assert.equal(panels.length, 2);
  assert.equal(panels[0]!.revealed.length, 1);
  panels[0]!.dispose();
  open("viewer", "a.html", { key: "file:///a.html" });
  assert.equal(panels.length, 3);
  // A keyless panel of the same type is a third kind, not any of those.
  open("viewer", "none");
  assert.equal(panels.length, 4);
});

test("a panel that shows a vault's files may load that vault's files and not the extension's", () => {
  const { adapter, panels, uri } = load();
  const open = adapter.createLumierePanel(uri("ext") as never);
  const panel = open("viewer", "a.html", {
    key: "k",
    column: -2,
    resourceRoots: ["file:///home/reader/vault"],
    retainContext: true,
  });
  const made = panels[0]!;
  assert.deepEqual(made.options.localResourceRoots.map(String), [
    "file:///home/reader/vault",
  ]);
  assert.equal(made.options.enableScripts, true);
  assert.equal(made.options.retainContextWhenHidden, true);
  assert.equal(made.column, -2);
  assert.equal(
    panel.webview.resource("file:///home/reader/vault/a.html"),
    "https://webview.test/file:///home/reader/vault/a.html",
  );
});

test("a panel runs scripts, follows no command links and listens to nothing until a plugin asks", () => {
  const { adapter, panels, uri } = load();
  const open = adapter.createLumierePanel(uri("ext") as never);
  open("viewer", "a.html", {
    key: "k",
    resourceRoots: ["file:///home/reader/vault"],
  });
  open("graph", "Vault Graph");
  for (const made of panels) {
    assert.equal(made.options.enableScripts, true);
    assert.equal(made.options.enableCommandUris, false);
    // Creating a panel registers no handler: the host hears nothing from a
    // page unless the plugin that made the panel says it will.
    assert.equal(made.messageHandlers, 0);
  }
});
