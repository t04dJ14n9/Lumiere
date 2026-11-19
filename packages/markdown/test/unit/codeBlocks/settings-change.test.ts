import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { withHost } from "../../support/vscode-fake";
import { provideHostServices } from "../../../src/shared/host";
import { codeBlocksHost } from "../../../src/plugins/codeBlocks/host";
import { protocol } from "../../../src/plugins/codeBlocks/protocol";
import { fixture } from "../agent-bridge/fixture";

const settle = async () => {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// Each notice makes the panel drop and re-render every rendered code block.
test("a settings change that leaves code blocks as they were tells no panel", async () => {
  const f = fixture();
  let enabled = true;
  const changes: (() => void)[] = [];
  const root = createRoot();
  root.provide("editors", f.editors);
  provideHostServices(
    root,
    withHost(f.host, {
      workspace: { isTrusted: () => true },
      settings: {
        forNote: () => ({
          preset: "obsidian",
          mode: "livePreview",
          features: { codeBlocks: { enabled, config: {} } },
        }),
        onChange: (listener) => {
          changes.push(listener);
          return () => {};
        },
      },
    }),
  );
  root.plugin(codeBlocksHost);
  root.plugin({
    name: "example",
    inject: { required: ["codeBlocks"] },
    apply(ctx) {
      ctx.codeBlocks.register({
        language: "demo",
        render: async () => ({ markdown: "ok" }),
      });
    },
  });
  await root.settled();
  const notices: string[][] = [];
  f.pair.client.on(protocol, "changed", (value) => {
    notices.push([...value.languages]);
  });
  await f.pair.client.call(protocol, "current", {});

  const settingsChanged = () => {
    for (const listener of changes) {
      listener();
    }
  };
  settingsChanged();
  settingsChanged();
  await settle();
  assert.deepEqual(notices, []);

  enabled = false;
  settingsChanged();
  settingsChanged();
  await settle();
  assert.deepEqual(notices, [[]]);

  enabled = true;
  settingsChanged();
  await settle();
  assert.deepEqual(notices, [[], ["demo"]]);
  await root.dispose();
  await f.pair.dispose();
});
