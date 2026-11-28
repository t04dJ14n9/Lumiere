import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import type { Resources } from "../../../src/plugins/resources/api";
import { resourcesHost } from "../../../src/plugins/resources/host";
import { atRevision } from "../../../src/plugins/resources/revision-image";
import { resourcesWebview } from "../../../src/plugins/resources/webview";
import { vaultHost } from "../../../src/plugins/vault/host";
import type { Vault, Vaults } from "../../../src/plugins/vault/api";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { provideHostServices } from "../../../src/shared/host";
import type { PanelShell } from "../../../src/shared/host";
import type { GitAccess } from "../../../src/shared/git";
import { mediaExtensions } from "../../../src/shared/media-kinds";
import { fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

const ROOT = "file:///vault";
const NOTE = `${ROOT}/notes/Note.md`;
/** The note as Git history opens it: VS Code's `git:` URI at a commit. */
const HISTORY = "git:/vault/notes/Note.md?ref";
const IMAGE = `${ROOT}/assets/chart.jpg`;
const REVISION_BYTES = new Uint8Array([1, 2, 3]);

function file(path: string) {
  return { uri: `${ROOT}/${path}`, path, mtime: 7, size: 1 };
}

/** Git as the VS Code host reads it, for the one note above at commit `abc`. */
function git(): Partial<GitAccess> {
  return {
    sourceOf: (uri) =>
      uri === HISTORY ? { source: NOTE, ref: "abc" } : { source: uri },
    toGitUri: (uri, ref) => `git:${new URL(uri).pathname}?${ref}`,
  };
}

/** A panel showing the note from Git history, with its vault and page. */
async function historyPage() {
  const pair = rpcPair();
  const index = new MemoryVaultIndex({
    root: ROOT,
    folderNote: "",
    linkFormat: "shortest",
  });
  index.replaceFiles([file("notes/Note.md"), file("assets/chart.jpg")]);
  const opened: string[] = [];
  const reads: string[] = [];
  const vaults = {
    forDocument: async (uri: string) => {
      opened.push(uri);
      return { index } as unknown as Vault;
    },
  } as unknown as Vaults;
  const host = createRoot();
  provideHostServices(
    host,
    fakeHost({
      git: git(),
      workspace: {
        stat: async () => ({ mtime: 7, symbolicLink: false }),
        read: async (uri: string) => {
          reads.push(uri);
          return REVISION_BYTES;
        },
      },
    }),
  );
  host.provide("rpc", pair.host);
  host.provide("vaults", vaults);
  host.plugin(vaultHost, { documentUri: HISTORY });
  host.plugin(resourcesHost, {
    panel: {
      document: { uri: HISTORY },
      resource: (uri: string) => `webview:${uri}`,
    } as unknown as PanelShell,
  });
  const page = createRoot();
  page.provide("rpc", pair.client);
  page.plugin(resourcesWebview);
  let resources: Resources | undefined;
  page.plugin({
    name: "reader",
    inject: { required: ["resources"] },
    apply(ctx) {
      resources = ctx.resources;
    },
  });
  await Promise.all([host.settled(), page.settled()]);
  return {
    opened,
    reads,
    load: (target: string, source?: string) =>
      resources!.load(target, source, "markdown"),
    async dispose() {
      await page.dispose();
      await host.dispose();
      await pair.dispose();
    },
  };
}

test("a note opened from Git history uses the vault of its file", async () => {
  const page = await historyPage();
  try {
    assert.deepEqual(page.opened, [NOTE]);
  } finally {
    await page.dispose();
  }
});

test("a vault-root image in a note from Git history shows that commit's bytes", async () => {
  const page = await historyPage();
  try {
    for (const source of [undefined, HISTORY]) {
      const image = await page.load("/assets/chart.jpg", source);
      assert.equal(image.kind, "image");
      assert.equal(image.source, IMAGE);
      assert.equal(image.url, "data:image/jpeg;base64,AQID");
    }
    assert.deepEqual(page.reads.at(-1), "git:/vault/assets/chart.jpg?abc");
  } finally {
    await page.dispose();
  }
});

test("every image type the vault shows has its committed bytes", async () => {
  for (const extension of mediaExtensions.image) {
    const resource = await atRevision(
      {
        kind: "image",
        source: `${ROOT}/a.${extension}`,
        url: "webview:now",
      },
      "abc",
      {
        git: { toGitUri: (uri) => `git:${new URL(uri).pathname}` },
        workspace: { read: async () => REVISION_BYTES },
      },
    );
    assert.match(resource.url, /^data:image\//, extension);
  }
});

test("an image the commit does not have keeps the working tree's URL", async () => {
  const resource = {
    kind: "image",
    source: IMAGE,
    url: "webview:now",
  } as const;
  const shown = await atRevision(resource, "abc", {
    git: { toGitUri: () => "git:/vault/assets/chart.jpg" },
    workspace: {
      read: async () => {
        throw new Error("FileNotFound");
      },
    },
  });
  assert.deepEqual(shown, resource);
});
