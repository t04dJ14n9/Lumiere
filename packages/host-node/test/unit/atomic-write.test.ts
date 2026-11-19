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
import { renameOver, replaceFile } from "../../src/host/atomic-write";

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

/** A rename that fails with `code` the first `failures` times, as Windows does while another program has the target open. */
function renameHeld(code: string, failures: number) {
  const calls: Array<[string, string]> = [];
  const rename = async (from: string, to: string) => {
    calls.push([from, to]);
    if (calls.length <= failures) {
      throw Object.assign(new Error(`${code}: rename '${from}' -> '${to}'`), {
        code,
        syscall: "rename",
      });
    }
  };
  return { calls, rename };
}

test("on Windows a rename over a note another program holds open is tried again", async () => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    const held = renameHeld(code, 2);
    await renameOver("a.tmp", "a.md", {
      rename: held.rename,
      platform: "win32",
      delaysMs: [0, 0, 0],
    });
    assert.equal(held.calls.length, 3, code);
  }
});

test("a rename that keeps failing on Windows fails once the retries are spent", async () => {
  const held = renameHeld("EPERM", Infinity);
  await assert.rejects(
    renameOver("a.tmp", "a.md", {
      rename: held.rename,
      platform: "win32",
      delaysMs: [0, 0],
    }),
    { code: "EPERM" },
  );
  assert.equal(held.calls.length, 3);
});

test("elsewhere, or for another error, a failed rename is not tried again", async () => {
  const posix = renameHeld("EACCES", 1);
  await assert.rejects(
    renameOver("a.tmp", "a.md", {
      rename: posix.rename,
      platform: "linux",
      delaysMs: [0],
    }),
    { code: "EACCES" },
  );
  assert.equal(posix.calls.length, 1);
  const missing = renameHeld("ENOENT", 1);
  await assert.rejects(
    renameOver("a.tmp", "a.md", {
      rename: missing.rename,
      platform: "win32",
      delaysMs: [0],
    }),
    { code: "ENOENT" },
  );
  assert.equal(missing.calls.length, 1);
});
