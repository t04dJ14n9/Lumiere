import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { nodeFiles } from "../../src/host/node-platform";

async function scratch(t: test.TestContext): Promise<string> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-move-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const uri = (file: string) => pathToFileURL(file).toString();

test("moving onto a file that exists is refused, as VS Code's rename without overwrite", async (t) => {
  const dir = await scratch(t);
  const from = path.join(dir, "A.md");
  const to = path.join(dir, "B.md");
  await writeFile(from, "a");
  await writeFile(to, "b");
  await assert.rejects(nodeFiles.move(uri(from), uri(to)), {
    code: "EEXIST",
  });
  assert.equal(await readFile(from, "utf8"), "a");
  assert.equal(await readFile(to, "utf8"), "b");
});

test("a file or folder moves to a new name, and a note to another case of its own", async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, "folder"));
  await writeFile(path.join(dir, "folder", "Note.md"), "n");
  await nodeFiles.move(
    uri(path.join(dir, "folder")),
    uri(path.join(dir, "moved")),
  );
  assert.deepEqual(await readdir(path.join(dir, "moved")), ["Note.md"]);
  // On a case-insensitive disk the target "exists": it is the same file.
  await nodeFiles.move(
    uri(path.join(dir, "moved", "Note.md")),
    uri(path.join(dir, "moved", "note.md")),
  );
  assert.deepEqual(await readdir(path.join(dir, "moved")), ["note.md"]);
});

test("copying replaces what is at the target, as VS Code's copy with overwrite", async (t) => {
  const dir = await scratch(t);
  const from = path.join(dir, "A.md");
  const to = path.join(dir, "B.md");
  await writeFile(from, "a");
  await writeFile(to, "b");
  await nodeFiles.copy(uri(from), uri(to));
  assert.equal(await readFile(to, "utf8"), "a");
});
