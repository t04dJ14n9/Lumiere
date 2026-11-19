// Folders the reader picks are vaults of their own, at paths no other vault
// has, and keep those paths between visits.
import test from "node:test";
import assert from "node:assert/strict";
import { fileUri } from "@workshop/host-node/core";
import { MemoryFileSystem, Mounts } from "@workshop/host-web";
import { PickedFolders, type FolderStore } from "../../src/folders";

/** A picked folder holding one note, `Note.md`, with `text` in it. */
function folder(
  name: string,
  text: string,
  permission: () => PermissionState = () => "granted",
) {
  const handle = {
    name,
    kind: "directory",
    isSameEntry: async (other: unknown) => other === handle,
    queryPermission: async () => permission(),
    getFileHandle: async (file: string) => {
      if (file !== "Note.md") {
        throw new DOMException("Not found", "NotFoundError");
      }
      return { getFile: async () => new File([text], file) };
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

function memoryStore(
  kept: [string, FileSystemDirectoryHandle][] = [],
): FolderStore & { kept: [string, FileSystemDirectoryHandle][] } {
  return {
    kept,
    put: async (name, handle) => {
      const at = kept.findIndex(([other]) => other === name);
      if (at >= 0) {
        kept.splice(at, 1);
      }
      kept.push([name, handle]);
    },
    all: async () => kept,
  };
}

const note = (files: Mounts, vault: string) =>
  files.readText(fileUri(`${vault}/Note.md`));

test("a second folder of the same name is a vault of its own", async () => {
  const files = new Mounts();
  files.mount("/vaults/Lumière Demo", new MemoryFileSystem());
  const store = memoryStore();
  const picked = new PickedFolders(files, store);
  const work = folder("Notes", "work");
  const home = folder("Notes", "home");

  assert.equal(await picked.add(work), "/vaults/Notes");
  assert.equal(await picked.add(home), "/vaults/Notes 2");
  assert.equal(
    await picked.add(folder("Lumière Demo", "mine")),
    "/vaults/Lumière Demo 2",
  );
  assert.equal(await note(files, "/vaults/Notes"), "work");
  assert.equal(await note(files, "/vaults/Notes 2"), "home");
  assert.deepEqual(
    store.kept.map(([name]) => name),
    ["Notes", "Notes 2", "Lumière Demo 2"],
  );
});

test("the same folder picked again keeps its vault", async () => {
  const files = new Mounts();
  const picked = new PickedFolders(files, memoryStore());
  const notes = folder("Notes", "one");
  assert.equal(await picked.add(notes), "/vaults/Notes");
  assert.equal(await picked.add(notes), "/vaults/Notes");
  assert.equal(files.isMounted("/vaults/Notes 2"), false);
});

test("folders picked on an earlier visit come back at the paths they had", async () => {
  const files = new Mounts();
  const store = memoryStore([
    ["Notes", folder("Notes", "work")],
    ["Notes 2", folder("Notes", "home")],
  ]);
  await new PickedFolders(files, store).mountRemembered();
  assert.equal(await note(files, "/vaults/Notes"), "work");
  assert.equal(await note(files, "/vaults/Notes 2"), "home");
});
