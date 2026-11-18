import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@workshop/core";
import { containedReader } from "../../../src/plugins/attachments/local-source";

const BYTES = new Uint8Array([1, 2, 3]);

interface Options {
  folders?: string[];
  vaultRoot?: string | undefined;
  /** Where each root's links lead: `realContains` answers by URI. */
  realContains?: ((root: string, uri: string) => Promise<boolean>) | undefined;
  /** URIs that are symbolic links, for a host without `realContains`. */
  links?: string[];
}

function reader({
  folders = ["file:///work"],
  vaultRoot,
  realContains,
  links = [],
}: Options = {}) {
  const read: string[] = [];
  const ctx = {
    workspace: {
      folders: () => folders,
      read: async (uri: string) => {
        read.push(uri);
        return BYTES;
      },
      ...(realContains ? { realContains } : {}),
      files: { isSymbolicLink: async (uri: string) => links.includes(uri) },
    },
    vaults: {
      locate: async () =>
        vaultRoot === undefined
          ? undefined
          : { vault: { index: { root: vaultRoot } }, path: "Note.md" },
    },
  } as unknown as Context;
  return { read, load: containedReader(ctx, "file:///work/Note.md") };
}

test("a file inside a workspace folder is read", async () => {
  const { load, read } = reader();
  assert.equal(await load("file:///work/img/a%20b.png"), BYTES);
  assert.deepEqual(read, ["file:///work/img/a%20b.png"]);
});

test("a file outside every workspace folder is not read", async () => {
  const { load, read } = reader();
  for (const uri of [
    "file:///Users/me/.ssh/id_rsa.png",
    "file:///etc/passwd.png",
    "file:///work2/a.png",
    "file:///wor/a.png",
    "file:///work",
    "vscode-remote://ssh-remote/work/a.png",
    "https://ex.com/work/a.png",
  ]) {
    assert.equal(await load(uri), undefined, uri);
  }
  assert.deepEqual(read, []);
});

test("a path that climbs out of the folder is not read, however it is written", async () => {
  const { load, read } = reader();
  for (const uri of [
    "file:///work/../etc/a.png",
    "file:///work/img/../../etc/a.png",
    "file:///work/%2e%2e/etc/a.png",
    "file:///work/%2E%2E/etc/a.png",
    "file:///work/img%2F..%2F..%2Fetc/a.png",
    "file:///work/img%5C..%5Ca.png",
  ]) {
    assert.equal(await load(uri), undefined, uri);
  }
  assert.deepEqual(read, []);
});

test("the note's vault counts as inside, though it is no workspace folder", async () => {
  const { load } = reader({ folders: [], vaultRoot: "file:///Vaults/Notes" });
  assert.equal(await load("file:///Vaults/Notes/a.png"), BYTES);
  assert.equal(await load("file:///Vaults/Other/a.png"), undefined);
});

test("a symbolic link that leads out is not followed, where the host resolves links", async () => {
  const { load, read } = reader({
    realContains: async (_root, uri) => !uri.includes("/escape/"),
  });
  assert.equal(await load("file:///work/img/a.png"), BYTES);
  assert.equal(await load("file:///work/escape/a.png"), undefined);
  assert.deepEqual(read, ["file:///work/img/a.png"]);
});

test("a file that is not there is not read", async () => {
  const { load, read } = reader({
    realContains: async () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(await load("file:///work/missing.png"), undefined);
  assert.deepEqual(read, []);
});

test("where links cannot be resolved, a link on the path refuses the file", async () => {
  const { load, read } = reader({ links: ["file:///work/shared"] });
  assert.equal(await load("file:///work/img/a.png"), BYTES);
  assert.equal(await load("file:///work/shared/a.png"), undefined);
  assert.deepEqual(read, ["file:///work/img/a.png"]);
});
