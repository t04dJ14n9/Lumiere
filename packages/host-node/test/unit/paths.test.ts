import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEmptyFile,
  isInsideRegisteredRoot,
  resolveContainedNote,
  assertContained,
} from "../../src/host/paths";
import { replaceFile } from "../../src/host/atomic-write";

async function directory(t: test.TestContext, prefix: string) {
  // The real path: on macOS the temporary folder is behind a symlink
  // (/var → /private/var), and resolved notes come back real.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a note opens only when its real path stays inside the workspace", async (t) => {
  const root = await directory(t, "lumiere-root-");
  const outside = await directory(t, "lumiere-out-");
  const note = path.join(root, "Note.md");
  await writeFile(note, "hello");
  await symlink(path.join(outside, "secret"), path.join(root, "link.md"));
  await writeFile(path.join(outside, "secret"), "no");

  const opened = await resolveContainedNote(note, root);
  assert.equal(opened?.note, note);
  assert.equal(opened?.root, root);
  assert.equal(await resolveContainedNote(note, "/"), undefined);
  assert.equal(
    await resolveContainedNote(path.join(root, "link.md"), root),
    undefined,
  );
  await assert.rejects(
    assertContained(
      pathToFileURL(root).toString(),
      pathToFileURL(path.join(root, "link.md")).toString(),
    ),
  );
  await symlink(
    path.join(outside, "missing.md"),
    path.join(root, "dangling.md"),
  );
  await symlink(
    path.join(outside, "missing-dir"),
    path.join(root, "dangling-dir"),
  );
  await assert.rejects(
    assertContained(
      pathToFileURL(root).toString(),
      pathToFileURL(path.join(root, "dangling.md")).toString(),
    ),
  );
  await assert.rejects(
    assertContained(
      pathToFileURL(root).toString(),
      pathToFileURL(path.join(root, "dangling-dir", "pwned.md")).toString(),
    ),
  );
  await assertContained(
    pathToFileURL(root).toString(),
    pathToFileURL(path.join(root, "new-folder", "fresh.md")).toString(),
  );
});

test("writing does not follow a symlink, and creating does not truncate", async (t) => {
  const root = await directory(t, "lumiere-write-");
  const outside = await directory(t, "lumiere-target-");
  const secret = path.join(outside, "secret");
  await writeFile(secret, "keep");
  const link = path.join(root, "link.md");
  await symlink(secret, link);
  await assert.rejects(replaceFile(link, "changed"));
  assert.equal(await readFile(secret, "utf8"), "keep");

  const file = path.join(root, "New.md");
  await writeFile(file, "keep");
  assert.equal(await createEmptyFile(file), false);
  assert.equal(await readFile(file, "utf8"), "keep");
  // A link in the way counts as taken, whatever it points at.
  assert.equal(await createEmptyFile(link), false);
  assert.equal(await readFile(secret, "utf8"), "keep");

  const fresh = path.join(root, "Fresh.md");
  assert.equal(await createEmptyFile(fresh), true);
  assert.equal(await readFile(fresh, "utf8"), "");
});

test("a folder is trusted only inside a workspace the embedder registered", () => {
  const uri = (file: string) => pathToFileURL(file).toString();
  const roots = [uri("/work/vault"), uri("/work/notes/")];
  assert.equal(isInsideRegisteredRoot(roots, uri("/work/vault")), true);
  assert.equal(isInsideRegisteredRoot(roots, uri("/work/vault/docs")), true);
  assert.equal(isInsideRegisteredRoot(roots, uri("/work/notes/a/b")), true);
  // Its parent, a sibling that shares the prefix, and a dot-dot escape.
  assert.equal(isInsideRegisteredRoot(roots, uri("/work")), false);
  assert.equal(isInsideRegisteredRoot(roots, uri("/work/vault2")), false);
  assert.equal(
    isInsideRegisteredRoot(roots, "file:///work/vault/../private"),
    false,
  );
  assert.equal(isInsideRegisteredRoot([], uri("/work/vault")), false);
  assert.equal(isInsideRegisteredRoot(roots, "https://example.com/"), false);
  // A filesystem root, however spelled, holds everything and so trusts nothing.
  for (const root of ["file:///", "file:", "file://"]) {
    assert.equal(isInsideRegisteredRoot([root], uri("/work/vault")), false);
  }
});
