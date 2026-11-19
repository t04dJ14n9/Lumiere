import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetadataChanges } from "../../../src/host/git-metadata-changes";

async function gitDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mw-metadata-changes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "HEAD"), "ref: refs/heads/main\n");
  await mkdir(join(dir, "refs", "heads"), { recursive: true });
  await writeFile(join(dir, "refs", "heads", "main"), `${"a".repeat(40)}\n`);
  return dir;
}

test("a file only touched is no change; one replaced, grown, made or removed is", async (t) => {
  const dir = await gitDir(t);
  const changes = new MetadataChanges(dir, false);
  const head = join(dir, "HEAD");
  chmodSync(head, statSync(head).mode);
  assert.equal(changes.changed("HEAD"), false);

  // git's own write: a lock file renamed over the old one.
  await writeFile(join(dir, "HEAD.lock"), "ref: refs/heads/next\n");
  assert.equal(changes.changed("HEAD.lock"), true);
  renameSync(join(dir, "HEAD.lock"), head);
  assert.equal(changes.changed("HEAD"), true);
  assert.equal(changes.changed("HEAD.lock"), true);
  assert.equal(changes.changed("HEAD"), false, "each change counts once");

  await writeFile(head, "ref: refs/heads/next\nmore\n", { flag: "a" });
  assert.equal(changes.changed("HEAD"), true);
  rmSync(head);
  assert.equal(changes.changed("HEAD"), true);
});

test("a recursive folder knows its nested files from the start", async (t) => {
  const dir = await gitDir(t);
  const refs = join(dir, "refs");
  const changes = new MetadataChanges(refs, true);
  const main = join("heads", "main");
  chmodSync(join(refs, main), statSync(join(refs, main)).mode);
  assert.equal(changes.changed(main), false);
  await writeFile(join(refs, "heads", "topic"), `${"b".repeat(40)}\n`);
  assert.equal(changes.changed(join("heads", "topic")), true);
});

test("a notification that names no file is a change", async (t) => {
  const changes = new MetadataChanges(await gitDir(t), false);
  assert.equal(changes.changed(null), true);
});
