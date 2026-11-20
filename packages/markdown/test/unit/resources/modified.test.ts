import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import type { Resources } from "../../../src/plugins/resources/api";
import {
  resourcesHost,
  CHANGED_NOTICE_DELAY_MS,
} from "../../../src/plugins/resources/host";
import { resourcesWebview } from "../../../src/plugins/resources/webview";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { provideHostServices } from "../../../src/shared/host";
import type { PanelShell } from "../../../src/shared/host";
import { fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

const ROOT = "file:///vault";
const NOTE = `${ROOT}/Note.md`;

function file(path: string, mtime = 7) {
  return { uri: `${ROOT}/${path}`, path, mtime, size: 1 };
}

/** A note's panel and its page, with the vault index the host reads. */
async function notePage() {
  const pair = rpcPair();
  const vault = new MemoryVaultIndex({
    root: ROOT,
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles(["Note.md", "Photo.png", "Other.png"].map((p) => file(p)));
  let mtime = 7;
  const host = createRoot();
  provideHostServices(
    host,
    fakeHost({
      workspace: { stat: async () => ({ mtime, symbolicLink: false }) },
    }),
  );
  host.provide("rpc", pair.host);
  host.provide("vault", vault);
  host.plugin(resourcesHost, {
    panel: {
      document: { uri: NOTE },
      resource: (uri: string) => uri,
    } as unknown as PanelShell,
  });
  const page = createRoot();
  page.provide("rpc", pair.client);
  page.plugin(resourcesWebview);
  let resources: Resources | undefined;
  const modified: (readonly string[])[] = [];
  page.plugin({
    name: "reader",
    inject: { required: ["resources"] },
    apply(ctx) {
      resources = ctx.resources;
      ctx.on("resources/modified", (sources) => modified.push(sources));
    },
  });
  await Promise.all([host.settled(), page.settled()]);
  return {
    vault,
    modified,
    setMtime: (value: number) => (mtime = value),
    load: (target: string) => resources!.load(target, NOTE, "wikilink"),
    async dispose() {
      await page.dispose();
      await host.dispose();
      await pair.dispose();
    },
  };
}

/** Until the host's gathered notice reaches the page. */
function delivered(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, CHANGED_NOTICE_DELAY_MS + 20),
  );
}

test("a page hears, once per burst, that a file it shows was rewritten", async () => {
  const page = await notePage();
  assert.equal((await page.load("Photo.png")).url, `${ROOT}/Photo.png?v=7`);

  page.vault.upsertFile(file("Other.png", 8));
  await delivered();
  assert.deepEqual(page.modified, [], "not for a file the page never showed");

  page.setMtime(9);
  page.vault.upsertFile(file("Photo.png", 8));
  page.vault.upsertFile(file("Photo.png", 9));
  await delivered();
  assert.deepEqual(page.modified, [[`${ROOT}/Photo.png`]]);
  assert.equal(
    (await page.load("Photo.png")).url,
    `${ROOT}/Photo.png?v=9`,
    "the page resolves it again, with its new version",
  );
  await page.dispose();
});

test("a page hears when a file it shows is moved or removed, then forgets it", async () => {
  const page = await notePage();
  await page.load("Photo.png");
  await page.load("Other.png");
  page.vault.renameFile("Photo.png", file("Moved.png"));
  page.vault.deleteFile("Other.png");
  await delivered();
  assert.deepEqual(page.modified, [[`${ROOT}/Photo.png`, `${ROOT}/Other.png`]]);
  page.vault.upsertFile(file("Photo.png", 10));
  await delivered();
  assert.equal(page.modified.length, 1, "a new file at the old path is new");
  await page.dispose();
});
