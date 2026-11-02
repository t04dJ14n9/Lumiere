import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../shared/host";
import type { PanelShell } from "../../shared/host";
import { fakeHost } from "../../../test/support/vscode-fake";
import { rpcPair } from "../../../test/support/rpc-pair";
import { lookUpHost, openInDictionary } from "./host";
import { protocol } from "./protocol";

function dictionary(platform: string) {
  const opened: string[] = [];
  return {
    opened,
    host: {
      platform,
      navigation: {
        external: async (href: string) => {
          opened.push(href);
          return true;
        },
      },
    },
  };
}

test("on macOS the host opens the word in the Dictionary app", async () => {
  const { opened, host } = dictionary("darwin");
  assert.equal(await openInDictionary("serendipity", host), true);
  assert.equal(await openInDictionary("café", host), true);
  assert.deepEqual(opened, ["dict://serendipity", "dict://caf%C3%A9"]);
});

test("off macOS the host opens nothing", async () => {
  for (const platform of ["linux", "win32", ""]) {
    const { opened, host } = dictionary(platform);
    assert.equal(await openInDictionary("word", host), false, platform);
    assert.deepEqual(opened, [], platform);
  }
});

test("the host refuses what is not one word, whatever the webview sends", async () => {
  const { opened, host } = dictionary("darwin");
  for (const word of ["", "two\nlines", "a".repeat(101), "nul\u0000"]) {
    assert.equal(await openInDictionary(word, host), false, word);
  }
  assert.deepEqual(opened, []);
});

async function panelHost() {
  const root = createRoot();
  const pair = rpcPair();
  const opened: string[] = [];
  root.provide("rpc", pair.host);
  provideHostServices(
    root,
    fakeHost({
      navigation: {
        external: async (href) => {
          opened.push(href);
          return true;
        },
      },
    }),
  );
  root.plugin(lookUpHost, { panel: {} as PanelShell });
  await root.settled();
  return { root, client: pair.client, opened };
}

test("a note's Look Up request reaches the Dictionary app only on macOS", async () => {
  const { root, client, opened } = await panelHost();
  const isMac = process.platform === "darwin";
  assert.equal(await client.call(protocol, "lookUp", { word: "word" }), isMac);
  assert.deepEqual(opened, isMac ? ["dict://word"] : []);
  await root.dispose();
});

test("the request schema refuses an empty or over-long word before the host sees it", async () => {
  const { root, client, opened } = await panelHost();
  for (const word of ["", "a".repeat(101)]) {
    await assert.rejects(client.call(protocol, "lookUp", { word }));
  }
  assert.deepEqual(opened, []);
  await root.dispose();
});
