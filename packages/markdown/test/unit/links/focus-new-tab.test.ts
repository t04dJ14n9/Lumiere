import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { PanelShell } from "../../../src/shared/host";
import { linksHost } from "../../../src/plugins/links/host";
import { protocol } from "../../../src/plugins/links/protocol";
import type { VaultIndex } from "../../../src/plugins/vault/api";
import { rpcPair } from "../../support/rpc-pair";
import { fakeHost } from "../../support/vscode-fake";

/** Follows `request` with the links setting `focusNewTab` as given; the open's place and options. */
async function openWith(
  focusNewTab: boolean | undefined,
  request: { side: boolean; tab?: boolean },
): Promise<{ place: unknown; options: unknown }> {
  const root = createRoot();
  const pair = rpcPair();
  const opened: unknown[][] = [];
  root.provide("rpc", pair.host);
  root.provide("resources", {
    async load() {
      throw new Error("unused");
    },
  });
  root.provide("vault", {
    root: "memory:/vault",
    onDidResolve: () => () => {},
    unresolvedLinks: () => new Map(),
    classifyLink: () => undefined,
    resolveLink: () => undefined,
  } as unknown as VaultIndex);
  provideHostServices(
    root,
    fakeHost({
      settings: {
        forNote: () => ({
          preset: "obsidian",
          mode: "livePreview",
          features: {
            links: {
              enabled: true,
              config: focusNewTab === undefined ? {} : { focusNewTab },
            },
          },
        }),
      },
      navigation: {
        resolve: async ({ path }) => `memory:/vault/${path}`,
        async open(...args) {
          opened.push(args);
        },
      },
    }),
  );
  root.plugin(linksHost, {
    panel: {
      id: "pane",
      document: { uri: "memory:/vault/Source.md" },
      active: () => true,
    } as PanelShell,
  });
  await root.settled();
  await pair.client.call(protocol, "open", {
    href: "Target.md",
    wiki: false,
    ...request,
  });
  await root.dispose();
  await pair.dispose();
  const [, , , place, , , options] = opened[0]!;
  return { place, options };
}

test("a link opened in a new tab or beside keeps the focus when focusNewTab is off", async () => {
  for (const request of [{ side: false, tab: true }, { side: true }] as const) {
    const { options } = await openWith(false, request);
    assert.deepEqual(options, { preserveFocus: true });
  }
});

test("focusNewTab defaults to on: the new tab takes the focus", async () => {
  for (const focusNewTab of [undefined, true]) {
    const { options } = await openWith(focusNewTab, { side: false, tab: true });
    assert.deepEqual(options, { preserveFocus: false });
  }
});

test("a link followed in the current tab never changes the focus", async () => {
  const { place, options } = await openWith(false, { side: false });
  assert.equal(place, "here");
  assert.deepEqual(options, { preserveFocus: false });
});
