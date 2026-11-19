// A vault in a folder handle hands a file over as the browser's own File,
// which is read from disk only as far as it is used (a video's ranges).
import test from "node:test";
import assert from "node:assert/strict";
import { HandleFileSystem } from "../../src/handle-fs";

type Tree = { readonly [name: string]: File | Tree };

/** A folder handle over `tree`, as far as reading needs one. */
function folder(tree: Tree): FileSystemDirectoryHandle {
  const missing = () =>
    Promise.reject(new DOMException("Not found", "NotFoundError"));
  return {
    getDirectoryHandle: (name: string) => {
      const entry = tree[name];
      return entry && !(entry instanceof File)
        ? Promise.resolve(folder(entry))
        : missing();
    },
    getFileHandle: (name: string) => {
      const entry = tree[name];
      return entry instanceof File
        ? Promise.resolve({ getFile: async () => entry })
        : missing();
    },
  } as unknown as FileSystemDirectoryHandle;
}

test("a file is handed over as its File, not read", async () => {
  const clip = new File([new Uint8Array(1000)], "clip.webm");
  const vault = new HandleFileSystem(
    folder({ attachments: { "clip.webm": clip } }),
  );
  assert.equal(await vault.readBlob("attachments/clip.webm"), clip);
  await assert.rejects(vault.readBlob("attachments/other.webm"), {
    code: "FileNotFound",
  });
  await assert.rejects(vault.readBlob("elsewhere/clip.webm"), {
    code: "FileNotFound",
  });
});

type Entries = Map<string, string | Entries>;

const notFoundError = () => new DOMException("Not found", "NotFoundError");

/** A folder handle that can be written, over a tree of text files. */
function writable(entries: Entries): FileSystemDirectoryHandle {
  return {
    getDirectoryHandle: async (
      name: string,
      options?: { create?: boolean },
    ) => {
      let entry = entries.get(name);
      if (entry === undefined && options?.create) {
        entry = new Map();
        entries.set(name, entry);
      }
      if (!(entry instanceof Map)) {
        throw notFoundError();
      }
      return writable(entry);
    },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!entries.has(name) && options?.create) {
        entries.set(name, "");
      }
      if (typeof entries.get(name) !== "string") {
        throw notFoundError();
      }
      return {
        getFile: async () => new File([entries.get(name) as string], name),
        createWritable: async () => ({
          write: async (data: Uint8Array) =>
            entries.set(name, new TextDecoder().decode(data)),
          close: async () => {},
        }),
      };
    },
    removeEntry: async (name: string) => {
      const entry = entries.get(name);
      if (entry === undefined) {
        throw notFoundError();
      }
      if (entry instanceof Map && entry.size > 0) {
        throw new DOMException("Not empty", "InvalidModificationError");
      }
      entries.delete(name);
    },
    entries: async function* () {
      for (const [name, entry] of entries) {
        yield [name, { kind: entry instanceof Map ? "directory" : "file" }];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

test("a folder moves with everything in it, and nothing is moved over", async () => {
  const daily: Entries = new Map<string, string | Entries>([
    ["Today.md", "# Today"],
    ["old", new Map([["Last.md", "last"]])],
  ]);
  const vault = new HandleFileSystem(
    writable(
      new Map<string, string | Entries>([
        ["daily", daily],
        ["Welcome.md", "# Welcome"],
      ]),
    ),
  );
  await assert.rejects(vault.move("Welcome.md", "daily/Today.md"), {
    code: "FileExists",
  });
  await vault.move("daily", "journal");
  assert.equal(await vault.stat("daily"), undefined);
  const text = async (path: string) =>
    new TextDecoder().decode(await vault.read(path));
  assert.equal(await text("journal/Today.md"), "# Today");
  assert.equal(await text("journal/old/Last.md"), "last");
});
