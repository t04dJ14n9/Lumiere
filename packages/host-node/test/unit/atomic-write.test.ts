import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { replaceFile } from "../../src/host/atomic-write";

async function directory(t: test.TestContext, prefix: string) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  t.after(async () => {
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

const isPosix = process.platform !== "win32";
const isRoot = process.getuid?.() === 0;

test("a save replaces the note by renaming a new file over it, leaving nothing beside it", async (t) => {
  const root = await directory(t, "lumiere-atomic-");
  const note = path.join(root, "Note.md");
  await writeFile(note, "a much longer first version");
  const before = await stat(note);

  await replaceFile(note, "short", pathToFileURL(root).toString());
  assert.equal(await readFile(note, "utf8"), "short");
  // Written in place, the note would keep its inode and be empty for a moment.
  assert.notEqual((await stat(note)).ino, before.ino);
  assert.deepEqual(await readdir(root), ["Note.md"]);

  await replaceFile(note, new Uint8Array([104, 105]));
  assert.equal(await readFile(note, "utf8"), "hi");
  assert.deepEqual(await readdir(root), ["Note.md"]);
});

test(
  "a writable note in a folder that takes no new file is still saved, in place",
  {
    skip: !isPosix || isRoot,
  },
  async (t) => {
    const root = await directory(t, "lumiere-atomic-");
    const note = path.join(root, "Note.md");
    await writeFile(note, "first");
    await chmod(root, 0o555);
    await replaceFile(note, "second", pathToFileURL(root).toString());
    await chmod(root, 0o755);
    assert.equal(await readFile(note, "utf8"), "second");
    assert.deepEqual(await readdir(root), ["Note.md"]);
  },
);

test("a save keeps the note's permissions", { skip: !isPosix }, async (t) => {
  const root = await directory(t, "lumiere-atomic-");
  const note = path.join(root, "Note.md");
  await writeFile(note, "first");
  await chmod(note, 0o640);
  await replaceFile(note, "second", pathToFileURL(root).toString());
  assert.equal((await stat(note)).mode & 0o777, 0o640);
});

test("a symlinked note inside the workspace is saved through its link, which stays a link", async (t) => {
  const root = await directory(t, "lumiere-atomic-");
  const real = path.join(root, "Real.md");
  const link = path.join(root, "Link.md");
  await writeFile(real, "first");
  await symlink(real, link);
  await replaceFile(link, "second", pathToFileURL(root).toString());
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(await readFile(real, "utf8"), "second");
  assert.deepEqual((await readdir(root)).sort(), ["Link.md", "Real.md"]);
});

test("a link to a file outside the workspace is not saved through", async (t) => {
  const root = await directory(t, "lumiere-atomic-");
  const outside = await directory(t, "lumiere-outside-");
  const secret = path.join(outside, "secret.md");
  await writeFile(secret, "keep");
  const link = path.join(root, "Link.md");
  await symlink(secret, link);
  await assert.rejects(
    replaceFile(link, "changed", pathToFileURL(root).toString()),
    { name: "OutsideWorkspace" },
  );
  assert.equal(await readFile(secret, "utf8"), "keep");
  assert.deepEqual(await readdir(outside), ["secret.md"]);
});
