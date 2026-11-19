import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { nodeFiles } from "../../src/host/node-platform";
import {
  assertOpenedInside,
  createEmptyFile,
  readContainedBytes,
} from "../../src/host/paths";
import { replaceFile } from "../../src/host/atomic-write";
import type { HostFiles } from "../../src/host/platform";
import {
  createHostVaultSystem,
  type HostVaultOptions,
} from "../../src/host/vault";
import {
  createHostWorkspace,
  createWorkspaceFiles,
} from "../../src/host/workspace";
import type { WorkspaceFiles } from "@workshop/markdown/portable";

/**
 * The race of #645: the containment check passes while `assets` is an
 * ordinary folder, then another process swaps it for a symlink to a folder
 * outside. The tests build the state after the swap and call the step that
 * follows the check, so the outcome does not depend on timing.
 */
interface Swapped {
  readonly root: string;
  readonly rootUri: string;
  readonly outside: string;
  /** `<root>/assets/image.png`, the path the write was checked for. */
  readonly target: string;
  /** Replace `<root>/assets` by a link to `outside`. */
  swap(): Promise<void>;
}

async function directory(t: test.TestContext, prefix: string) {
  // The real path: on macOS the temporary folder is behind a symlink.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function workspaceWithAssets(t: test.TestContext): Promise<Swapped> {
  const root = await directory(t, "lumiere-swap-root-");
  const outside = await directory(t, "lumiere-swap-out-");
  await mkdir(path.join(root, "assets"));
  return {
    root,
    rootUri: pathToFileURL(root).toString(),
    outside,
    target: path.join(root, "assets", "image.png"),
    async swap() {
      await rename(path.join(root, "assets"), path.join(root, "assets.moved"));
      await symlink(outside, path.join(root, "assets"));
    },
  };
}

test("a descriptor opened through a swapped ancestor is not inside the workspace", async (t) => {
  const { root, rootUri, outside, target, swap } = await workspaceWithAssets(t);
  await writeFile(path.join(outside, "image.png"), "outside");
  await swap();

  const handle = await open(target, "r");
  try {
    await assert.rejects(assertOpenedInside(handle, target, rootUri), {
      name: "OutsideWorkspace",
    });
  } finally {
    await handle.close();
  }

  // A descriptor for the real file in the root passes.
  const inside = path.join(root, "assets.moved", "image.png");
  await writeFile(inside, "inside");
  const own = await open(inside, "r");
  try {
    await assertOpenedInside(own, inside, rootUri);
  } finally {
    await own.close();
  }
});

test("a descriptor whose file was replaced after the open is not the file on disk", async (t) => {
  const { root, rootUri } = await workspaceWithAssets(t);
  const file = path.join(root, "Note.md");
  await writeFile(file, "first");
  const handle = await open(file, "r");
  try {
    await rename(file, path.join(root, "Note.old.md"));
    await writeFile(file, "second");
    await assert.rejects(assertOpenedInside(handle, file, rootUri), {
      name: "OutsideWorkspace",
    });
  } finally {
    await handle.close();
  }
});

test("a write through a swapped ancestor neither truncates nor fills the outside file", async (t) => {
  const { rootUri, outside, target, swap } = await workspaceWithAssets(t);
  const secret = path.join(outside, "image.png");
  await writeFile(secret, "keep me");
  await swap();

  await assert.rejects(replaceFile(target, "x", rootUri), {
    name: "OutsideWorkspace",
  });
  await assert.rejects(
    replaceFile(target, new Uint8Array([1, 2, 3]), rootUri),
    { name: "OutsideWorkspace" },
  );
  assert.equal(await readFile(secret, "utf8"), "keep me");
});

test("a write inside the workspace replaces the whole file", async (t) => {
  const { rootUri, target } = await workspaceWithAssets(t);
  await writeFile(target, "a much longer first version");

  await replaceFile(target, "short", rootUri);
  assert.equal(await readFile(target, "utf8"), "short");
  await replaceFile(target, new Uint8Array([104, 105]), rootUri);
  assert.equal(await readFile(target, "utf8"), "hi");
  // Without a root the write is as before: it does not follow a final link.
  await replaceFile(target, "plain");
  assert.equal(await readFile(target, "utf8"), "plain");
});

test("creating through a swapped ancestor leaves no file outside", async (t) => {
  const { rootUri, outside, target, swap } = await workspaceWithAssets(t);
  await swap();

  await assert.rejects(createEmptyFile(target, rootUri), {
    name: "OutsideWorkspace",
  });
  assert.deepEqual(await readdir(outside), []);
});

test("creating inside the workspace reports whether it made the file", async (t) => {
  const { rootUri, target } = await workspaceWithAssets(t);
  assert.equal(await createEmptyFile(target, rootUri), true);
  assert.equal(await createEmptyFile(target, rootUri), false);
});

test("a read through a swapped ancestor does not return the outside file", async (t) => {
  const { root, rootUri, outside, target, swap } = await workspaceWithAssets(t);
  await writeFile(path.join(outside, "image.png"), "outside secret");
  await writeFile(target, "inside");
  await swap();

  await assert.rejects(readContainedBytes(target, rootUri), {
    name: "OutsideWorkspace",
  });

  const note = path.join(root, "Note.md");
  await writeFile(note, "hello");
  assert.equal((await readContainedBytes(note, rootUri)).toString(), "hello");
  // A link that stays inside the workspace is still followed.
  await symlink(note, path.join(root, "alias.md"));
  assert.equal(
    (await readContainedBytes(path.join(root, "alias.md"), rootUri)).toString(),
    "hello",
  );
});

/** The host's files, with `swap` run right after the `nth` containment check. */
function swappedAfterCheck(nth: number, swap: () => Promise<void>): HostFiles {
  let checks = 0;
  return {
    ...nodeFiles,
    contain: async (root, uri) => {
      await nodeFiles.contain(root, uri);
      checks += 1;
      if (checks === nth) {
        await swap();
      }
    },
  };
}

test("writeText stops a swap after the check that follows the folders", async (t) => {
  const { rootUri, outside, target, swap } = await workspaceWithAssets(t);
  const secret = path.join(outside, "image.png");
  await writeFile(secret, "keep me");
  // Check one, the folders, check two (then the swap), create, save.
  const workspace = createWorkspaceFiles(swappedAfterCheck(2, swap), () => [
    rootUri,
  ]);

  await assert.rejects(
    workspace.writeText(pathToFileURL(target).toString(), "x"),
    { name: "OutsideWorkspace" },
  );
  assert.equal(await readFile(secret, "utf8"), "keep me");
});

test("writeBytes, createText and createBytes leave no file outside after the same swap", async (t) => {
  for (const write of [
    (files: WorkspaceFiles, uri: string) =>
      files.writeBytes(uri, new Uint8Array([1])),
    (files: WorkspaceFiles, uri: string) => files.createText(uri, "x"),
    (files: WorkspaceFiles, uri: string) =>
      files.createBytes(uri, new Uint8Array([1])),
  ]) {
    const { rootUri, outside, target, swap } = await workspaceWithAssets(t);
    const workspace = createWorkspaceFiles(swappedAfterCheck(2, swap), () => [
      rootUri,
    ]);

    await assert.rejects(write(workspace, pathToFileURL(target).toString()), {
      name: "OutsideWorkspace",
    });
    assert.deepEqual(await readdir(outside), []);
  }
});

test("a swap before the folders are made is caught by the check after them", async (t) => {
  const { rootUri, outside, swap } = await workspaceWithAssets(t);
  const workspace = createWorkspaceFiles(swappedAfterCheck(1, swap), () => [
    rootUri,
  ]);

  await assert.rejects(
    workspace.writeText(`${rootUri}/assets/sub/image.png`, "x"),
    { name: "OutsideWorkspace" },
  );
  // The folder made through the link stays empty: no file reached it.
  assert.deepEqual(await readdir(path.join(outside, "sub")), []);
});

test("read and readText refuse an outside file reached through a swapped ancestor", async (t) => {
  const failed = () => undefined;
  for (const read of [
    (files: HostFiles, rootUri: string, uri: string) =>
      createWorkspaceFiles(files, () => [rootUri]).readText(uri),
    (files: HostFiles, rootUri: string, uri: string) =>
      createHostWorkspace({ files, roots: () => [rootUri] })
        .read(uri)
        .then((bytes) => new TextDecoder().decode(bytes), failed),
    (files: HostFiles, rootUri: string, uri: string) =>
      createHostVaultSystem({
        platform: { files },
        roots: () => [rootUri],
      } as unknown as HostVaultOptions)
        .read(uri)
        .then((bytes) => new TextDecoder().decode(bytes), failed),
  ]) {
    const { rootUri, outside, target, swap } = await workspaceWithAssets(t);
    await writeFile(path.join(outside, "image.png"), "outside secret");
    const uri = pathToFileURL(target).toString();

    assert.equal(
      await read(swappedAfterCheck(1, swap), rootUri, uri),
      undefined,
    );
  }
});
