import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makePrivateFolder } from "../../src/extension/plugins/ideContext/private-folder";

const posix = process.platform !== "win32";

async function scratch(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-pdf-private-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test(
  "S3: the packet folder is made this user's alone",
  { skip: !posix },
  async (t) => {
    const folder = path.join(await scratch(t), "agent-ide-context");
    await makePrivateFolder(folder);
    const info = await stat(folder);
    assert.equal(info.uid, process.getuid!());
    assert.equal(info.mode & 0o777, 0o700);
    await chmod(folder, 0o755);
    await makePrivateFolder(folder);
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
  },
);

test(
  "S3: a link planted at the packet folder's name is refused",
  { skip: !posix },
  async (t) => {
    const dir = await scratch(t);
    const elsewhere = path.join(dir, "someone-else");
    await mkdir(elsewhere, { mode: 0o777 });
    const folder = path.join(dir, "agent-ide-context");
    await symlink(elsewhere, folder);
    await assert.rejects(
      makePrivateFolder(folder),
      /not a folder of this user's/,
    );
  },
);
