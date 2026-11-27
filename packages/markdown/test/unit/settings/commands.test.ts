import { provideHostServices } from "../../../src/shared/host";
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { commandsHost } from "../../../src/plugins/commands/host";
import { livePreviewHost } from "../../../src/plugins/livePreview/host";
import { features } from "../../../src/plugins/catalog";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { contributionId } from "../../../src/shared/setting-schema";
import { fakeHost, fakeDocument } from "../../support/vscode-fake";
import { fixture } from "../features/fixture";

test("every editor manifest command routes to its registered webview ID", async () => {
  const f = fixture();
  const settings = Object.fromEntries(
    features.map((manifest) => [
      manifest.id,
      {
        enabled: true,
        config: (manifest.config?.parse({}) ?? {}) as Record<string, unknown>,
      },
    ]),
  );
  await f.configure(settings);
  const native = new Map<string, () => unknown>();
  const calls: string[] = [];
  const panel = {
    id: "panel",
    document: fakeDocument(),
    rpc: {
      call: async (
        _protocol: unknown,
        method: string,
        params: { command: string },
      ) => {
        assert.equal(method, "run");
        calls.push(params.command);
        return true;
      },
    },
  } as unknown as EditorPanel;
  const root = createRoot();
  root.provide("editors", {
    all: () => [],
    active: () => panel,
    capture: async () => {
      throw new Error("unused");
    },
    restore: async () => {},
  });
  provideHostServices(
    root,
    fakeHost({
      settings: {
        forNote: () => ({
          preset: "obsidian",
          mode: "livePreview",
          features: settings,
        }),
      },
      hostCommands: {
        register: (id, run) => {
          assert.ok(!native.has(id), id);
          native.set(id, run);
          return () => {
            native.delete(id);
          };
        },
      },
    }),
  );
  root.plugin(commandsHost, { features });
  root.plugin(livePreviewHost);
  await root.settled();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const manifest of features) {
    for (const command of manifest.contributes?.commands ?? []) {
      if (!command.editorCommand) {
        continue;
      }
      assert.ok(f.handlers.has(command.editorCommand), command.id);
      const run = native.get(contributionId(command.id));
      assert.ok(run, command.id);
      await run();
      assert.equal(calls.at(-1), command.editorCommand);
    }
  }
  await native.get(contributionId("toggleSourceMode"))!();
  assert.equal(calls.at(-1), "editor:toggle-source");
  for (const command of [
    "save",
    "undo",
    "redo",
    "close",
    "saveClose",
    "openAsText",
  ]) {
    await native.get(contributionId(command))!();
    assert.equal(calls.at(-1), command);
  }
  await root.dispose();
  await f.root.dispose();
  assert.equal(native.size, 0);
});
for (const [mode, expected] of [
  ["livePreview", { host: ["toggleTextEditor"], webview: [] }],
  ["source", { host: [], webview: ["editor:toggle-source"] }],
] as const) {
  test(`Toggle Live Preview/Source Mode from ${mode} where the host has a text editor`, async () => {
    const native = new Map<string, () => unknown>();
    const executed: string[] = [];
    const webview: string[] = [];
    const root = createRoot();
    root.provide("editors", {
      all: () => [],
      active: () =>
        ({
          rpc: {
            call: async (
              _protocol: unknown,
              method: string,
              payload: unknown,
            ) =>
              method === "captureView"
                ? { mode }
                : webview.push((payload as { command: string }).command),
          },
        }) as unknown as EditorPanel,
      capture: async () => {
        throw new Error("unused");
      },
      restore: async () => {},
    });
    provideHostServices(
      root,
      fakeHost({
        activeEditor: { hasTextEditor: true },
        hostCommands: {
          register: (id, run) => {
            native.set(id, run);
            return () => {
              native.delete(id);
            };
          },
          execute: async (id) => {
            executed.push(id);
          },
        },
      }),
    );
    root.plugin(livePreviewHost);
    await root.settled();
    await native.get(contributionId("toggleSourceMode"))!();
    assert.deepEqual(
      executed,
      expected.host.map((id) => contributionId(id)),
    );
    assert.deepEqual(webview, expected.webview);
    await root.dispose();
  });
}
test("registered swap-line commands edit pure EditorState and preserve the moved selection", async () => {
  const f = fixture();
  await f.configure({ formatting: { enabled: true, config: {} } });
  f.view.dispatch({
    changes: {
      from: 0,
      to: f.view.state.doc.length,
      insert: "one\ntwo\nthree",
    },
    selection: { anchor: 4, head: 7 },
  });
  assert.equal(await f.handlers.get("editor:swap-line-up")!(), true);
  assert.equal(f.view.state.doc.toString(), "two\none\nthree");
  assert.equal(
    f.view.state.sliceDoc(
      f.view.state.selection.main.from,
      f.view.state.selection.main.to,
    ),
    "two",
  );
  assert.equal(await f.handlers.get("editor:swap-line-down")!(), true);
  assert.equal(f.view.state.doc.toString(), "one\ntwo\nthree");
  await f.root.dispose();
});
