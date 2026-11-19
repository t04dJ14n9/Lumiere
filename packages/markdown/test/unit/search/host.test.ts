import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import {
  searchHost,
  SEARCH_REFRESH_DELAY_MS,
} from "../../../src/plugins/search/host";
import { protocol } from "../../../src/plugins/search/protocol";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { provideHostServices, type PanelShell } from "../../../src/shared/host";
import { fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("query blocks are told to search again once the index stops resolving, not after every typing pause", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pair = rpcPair();
  const root = createRoot();
  try {
    const vault = new MemoryVaultIndex({
      root: "file:///vault",
      folderNote: "",
      linkFormat: "shortest",
    });
    root.provide("rpc", pair.host);
    root.provide("vault", vault);
    root.provide("vaults", {} as never);
    provideHostServices(root, fakeHost());
    root.plugin(searchHost, { panel: {} as PanelShell });
    await root.settled();
    let changed = 0;
    pair.client.on(protocol, "changed", () => {
      changed++;
    });
    // Typing in an open note: the index resolves after each pause.
    for (let pause = 0; pause < 5; pause++) {
      vault.notifyResolved();
      mock.timers.tick(SEARCH_REFRESH_DELAY_MS / 2);
    }
    await tick();
    assert.equal(changed, 0);
    mock.timers.tick(SEARCH_REFRESH_DELAY_MS);
    await tick();
    assert.equal(changed, 1);
  } finally {
    mock.timers.reset();
    await root.dispose();
    await pair.dispose();
  }
});
