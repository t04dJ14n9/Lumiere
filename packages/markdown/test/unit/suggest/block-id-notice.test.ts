import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices, type PanelShell } from "../../../src/shared/host";
import { protocol } from "../../../src/plugins/suggest/protocol";
import { suggestHost } from "../../../src/plugins/suggest/host";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

const HOME = "Intro line\n\nA body";

interface Setup {
  /** What the host's note really holds. */
  text?: string;
  apply?: boolean;
  open?: "fails";
  authorized?: boolean;
}

/** A suggest host over a vault of `Home.md` and an excluded `Hidden.md`. */
async function hostWith(setup: Setup = {}) {
  const pair = rpcPair();
  const informed: string[] = [];
  const vault = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  for (const [path, excluded] of [
    ["Home.md", false],
    ["Hidden.md", true],
  ] as const) {
    vault.upsertFile({
      path,
      uri: `file:///vault/${path}`,
      size: 1,
      mtime: 0,
      excluded,
    });
  }
  const root = createRoot();
  root.provide("rpc", pair.host);
  root.provide("vault", vault);
  root.provide("resources", {
    authorizeTarget: async () => {
      if (setup.authorized === false) {
        throw new Error("outside the workspace");
      }
    },
  } as never);
  provideHostServices(
    root,
    fakeHost({
      dialogs: {
        error: (message: string) => informed.push(message),
        inform: (message: string) => informed.push(message),
        ask: async () => undefined,
        pick: async () => undefined,
        pickMany: async () => undefined,
        input: async () => undefined,
      },
      hostDocuments: {
        open: async (uri) => {
          if (setup.open === "fails") {
            throw new Error("no such file");
          }
          return fakeDocument({ uri, getText: () => setup.text ?? HOME });
        },
        text: () => setup.text ?? HOME,
        apply: async () => setup.apply !== false,
      },
    }),
  );
  root.plugin(suggestHost, {
    panel: {
      document: fakeDocument({ uri: "file:///vault/Home.md" }),
    } as PanelShell,
  });
  await root.settled();
  const write = (override: { uri?: string; before?: string } = {}) =>
    pair.client.call(protocol, "addBlockId", {
      uri: "file:///vault/Home.md",
      at: HOME.length,
      before: "A body",
      insert: " ^abc123",
      here: false,
      ...override,
    });
  return {
    informed,
    write,
    pair,
    dispose: async () => {
      await root.dispose();
      await pair.dispose();
    },
  };
}

test("a block id that is written is not announced", async () => {
  const host = await hostWith();
  assert.equal(await host.write(), true);
  assert.deepEqual(host.informed, []);
  await host.dispose();
});

test("a block id that cannot be written is announced with why, and what the link does", async () => {
  const cases: [string, Setup, { uri?: string; before?: string }, RegExp][] = [
    [
      "the note changed after the list was made",
      { text: "Intro line\n\nA bodies" },
      {},
      /Home\.md.*changed after the list was made/u,
    ],
    [
      "an excluded note",
      {},
      { uri: "file:///vault/Hidden.md" },
      /Hidden\.md.*not in this vault, or is excluded/u,
    ],
    [
      "a file outside the vault",
      {},
      { uri: "file:///outside/config.ini" },
      /that note.*not in this vault, or is excluded/u,
    ],
    [
      "a target the workspace does not allow",
      { authorized: false },
      {},
      /Home\.md.*outside the folders Lumiere may edit/u,
    ],
    [
      "a note that cannot be opened",
      { open: "fails" },
      {},
      /could not be opened or edited/u,
    ],
    [
      "an edit VS Code refused",
      { apply: false },
      {},
      /did not accept the edit/u,
    ],
  ];
  for (const [name, setup, override, message] of cases) {
    const host = await hostWith(setup);
    assert.equal(await host.write(override), false, name);
    assert.equal(host.informed.length, 1, name);
    assert.match(host.informed[0]!, message, name);
    assert.match(host.informed[0]!, /The link goes to the note/u, name);
    await host.dispose();
  }
});

test("the host says when the block of the note being edited changed before its link was made", async () => {
  const host = await hostWith();
  host.pair.client.notify(protocol, "blockChanged", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.informed.length, 1);
  assert.match(host.informed[0]!, /block changed.*no link was inserted/u);
  await host.dispose();
});
