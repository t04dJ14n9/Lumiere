import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  makePrivateFolder,
  userTempFolder,
} from "../../../src/host/private-temp";

const posix = process.platform !== "win32";

async function scratch(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-private-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("S3: the agent folder's name carries the user's id", () => {
  const folder = userTempFolder("markdown-workshop-agent");
  assert.equal(path.dirname(folder), tmpdir());
  assert.equal(
    path.basename(folder),
    posix
      ? `markdown-workshop-agent-${process.getuid!()}`
      : "markdown-workshop-agent",
  );
});

test("S3: a new folder is this user's alone", { skip: !posix }, async (t) => {
  const folder = path.join(await scratch(t), "agent");
  await makePrivateFolder(folder);
  const info = await stat(folder);
  assert.ok(info.isDirectory());
  assert.equal(info.uid, process.getuid!());
  assert.equal(info.mode & 0o777, 0o700);
});

test(
  "S3: a folder of ours others can enter is closed",
  { skip: !posix },
  async (t) => {
    const folder = path.join(await scratch(t), "agent");
    await mkdir(folder);
    await chmod(folder, 0o777);
    await makePrivateFolder(folder);
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
  },
);

test(
  "S3: a link planted at the folder's name is refused",
  { skip: !posix },
  async (t) => {
    const dir = await scratch(t);
    const elsewhere = path.join(dir, "someone-else");
    await mkdir(elsewhere, { mode: 0o777 });
    const folder = path.join(dir, "agent");
    await symlink(elsewhere, folder);
    await assert.rejects(
      makePrivateFolder(folder),
      /not a folder of this user's/,
    );
  },
);
