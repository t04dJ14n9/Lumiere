import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { watchFile } from "../../src/host/watch";

async function scratch(t: test.TestContext): Promise<string> {
  // The real path: macOS reports events under /private/var, not /var.
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-watch-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Wait until `heard` is true; file events arrive late on some systems. */
async function until(heard: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 50) {
    if (heard()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`never heard ${what}`);
}

test("a file in folders that do not exist yet is heard when it appears", async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, ".obsidian", "app.json");
  let heard = 0;
  const stop = watchFile(file, () => heard++);
  t.after(stop);
  await mkdir(path.dirname(file));
  // Give the watch a moment to move down into the new folder.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(file, "{}");
  await until(() => heard > 0, "the file appear");
  const before = heard;
  await writeFile(file, '{"a": 1}');
  await until(() => heard > before, "the file change");
});

test("other files in the folder are not heard; a stopped watch hears nothing", async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, "watched.md");
  await writeFile(file, "");
  let heard = 0;
  const stop = watchFile(file, () => heard++);
  t.after(stop);
  // macOS may still report the file's creation, from just before the watch.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const settled = heard;
  await writeFile(path.join(dir, "other.md"), "x");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(heard, settled);
  stop();
  await writeFile(file, "changed");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(heard, settled);
});

test("watching under a path that cannot exist neither throws nor hears", () => {
  const stop = watchFile(
    path.join("/", "no-such-root-folder", "a", "b.md"),
    () => {
      assert.fail("heard a file that cannot exist");
    },
  );
  stop();
});

import { watchTree } from "../../src/host/watch-tree";

test("folders created and removed at once under a watched tree throw nothing, and files are still heard", async (t) => {
  const dir = await scratch(t);
  const heard: string[] = [];
  const uncaught: Error[] = [];
  const onUncaught = (error: Error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  t.after(() => process.off("uncaughtException", onUncaught));
  // The Linux path, whatever this machine is: it is the one that can throw.
  const stop = watchTree(dir, (relative) => heard.push(relative), "linux");
  t.after(stop);
  for (let round = 0; round < 40; round++) {
    const nested = path.join(dir, `gone-${round}`, "logs", "deeper");
    await mkdir(nested, { recursive: true });
    await rm(path.join(dir, `gone-${round}`), { recursive: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(uncaught, []);

  await mkdir(path.join(dir, "kept", "sub"), { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(path.join(dir, "kept", "sub", "note.md"), "x");
  await writeFile(path.join(dir, "top.md"), "x");
  await until(
    () => heard.includes("kept/sub/note.md") && heard.includes("top.md"),
    "files under the tree",
  );
  assert.deepEqual(uncaught, []);
});

test("a stopped tree watch hears nothing more", async (t) => {
  const dir = await scratch(t);
  const heard: string[] = [];
  const stop = watchTree(dir, (relative) => heard.push(relative), "linux");
  stop();
  await writeFile(path.join(dir, "late.md"), "x");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(heard, []);
});
