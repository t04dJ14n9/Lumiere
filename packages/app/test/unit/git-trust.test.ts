// S5: which vaults git may run in, asked once and remembered when allowed.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { GitTrustStore } from "../../src/server/git-trust";

async function store(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-git-trust-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "data", "git-trust.json");
  const trust = new GitTrustStore(file);
  await trust.load();
  const vault = path.join(dir, "vault");
  return { trust, file, vault, uri: pathToFileURL(vault).toString() };
}

test("a vault is untrusted until the reader answers, and asked about once", async (t) => {
  const { trust, vault, uri } = await store(t);
  let asks = 0;
  trust.onAsk(() => (asks += 1));
  assert.equal(trust.isTrusted(uri), false);
  assert.equal(trust.isTrusted(uri), false);
  assert.equal(asks, 1);
  assert.deepEqual(trust.waiting(), [vault]);

  await trust.answer(vault, false);
  assert.deepEqual(trust.waiting(), []);
  // Not Now: not asked again while the server runs.
  assert.equal(trust.isTrusted(uri), false);
  assert.deepEqual(trust.waiting(), []);
  await assert.rejects(trust.answer(vault, true), /did not ask/);
});

test("allowing git in a vault is remembered, and the pages are told", async (t) => {
  const { trust, file, vault, uri } = await store(t);
  let changes = 0;
  trust.onDidChange(() => (changes += 1));
  trust.isTrusted(uri);
  await trust.answer(vault, true);
  assert.equal(changes, 1);
  assert.equal(trust.isTrusted(uri), true);

  const again = new GitTrustStore(file);
  await again.load();
  let asks = 0;
  again.onAsk(() => (asks += 1));
  assert.equal(again.isTrusted(uri), true);
  assert.equal(asks, 0);
});

test("a root that is no file is never trusted", async (t) => {
  const { trust } = await store(t);
  assert.equal(trust.isTrusted("https://example.com/notes"), false);
  assert.deepEqual(trust.waiting(), []);
});
