import assert from "node:assert/strict";
import { test } from "node:test";
// First: files.ts imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { vscodePdfFiles } from "../../src/extension/plugins/pdf/files";

const SHA = "ef".repeat(32);
const PDF = "file:///vault/papers/a.pdf";
const FOLDER = "/vault/.lumiere/pdf-annotations";

/** The workspace has one folder, `/vault`, and `folder` as the annotations folder setting. */
async function inVault(run: () => Promise<void> | void, folder?: string) {
  const workspace = fake.workspace as Record<string, unknown>;
  const original = {
    getWorkspaceFolder: workspace["getWorkspaceFolder"],
    fs: workspace["fs"],
  };
  const files = new Map<string, string>();
  const calls: string[] = [];
  const at = (uri: fake.Uri) => uri.path;
  Object.assign(fake.workspace, {
    getWorkspaceFolder: () => ({ uri: fake.Uri.file("/vault") }),
    fs: {
      readFile: async (uri: fake.Uri) => {
        const text = files.get(at(uri));
        if (text === undefined) {
          throw fake.FileSystemError.FileNotFound(at(uri));
        }
        return new TextEncoder().encode(text);
      },
      createDirectory: async (uri: fake.Uri) => {
        calls.push(`mkdir ${at(uri)}`);
      },
      writeFile: async (uri: fake.Uri, bytes: Uint8Array) => {
        calls.push(`write ${at(uri)}`);
        files.set(at(uri), new TextDecoder().decode(bytes));
      },
      rename: async (from: fake.Uri, to: fake.Uri) => {
        calls.push(`rename ${at(from)} ${at(to)}`);
        files.set(at(to), files.get(at(from))!);
        files.delete(at(from));
      },
      delete: async (uri: fake.Uri) => {
        calls.push(`delete ${at(uri)}`);
        if (!files.delete(at(uri))) {
          throw fake.FileSystemError.FileNotFound(at(uri));
        }
      },
    },
  });
  if (folder !== undefined) {
    fake.configuration.set("lumiere.pdf.annotations.folder", folder);
  }
  try {
    await run();
    return { files, calls };
  } finally {
    Object.assign(fake.workspace, original);
    fake.configuration.delete("lumiere.pdf.annotations.folder");
  }
}

const bookmarks = () => vscodePdfFiles.bookmarks!;

test("a PDF's bookmarks are kept beside its annotation file, named by its hash", async () => {
  await inVault(() => {
    assert.equal(
      bookmarks().key!(PDF, SHA),
      `file://${FOLDER}/${SHA}.bookmarks.json`,
    );
    assert.equal(
      vscodePdfFiles.annotations!.key!(PDF, SHA),
      `file://${FOLDER}/${SHA}.json`,
    );
  });
});

test("lumiere.pdf.annotations.folder moves the bookmarks with the annotations", async () => {
  await inVault(() => {
    assert.equal(
      bookmarks().key!(PDF, SHA),
      `file:///vault/notes/marks/${SHA}.bookmarks.json`,
    );
    assert.equal(
      vscodePdfFiles.annotations!.key!(PDF, SHA),
      `file:///vault/notes/marks/${SHA}.json`,
    );
  }, "notes/marks");
  await inVault(() => {
    assert.equal(
      bookmarks().key!(PDF, SHA),
      `file:///elsewhere/${SHA}.bookmarks.json`,
    );
  }, "/elsewhere");
});

test("a file is written whole under a temporary name and renamed over the old one", async () => {
  const { files, calls } = await inVault(async () => {
    assert.equal(await bookmarks().read(PDF, SHA), undefined);
    await bookmarks().write(PDF, SHA, '{"version":1}\n');
    assert.equal(await bookmarks().read(PDF, SHA), '{"version":1}\n');
    // The same text again: the file is left alone.
    await bookmarks().write(PDF, SHA, '{"version":1}\n');
  });
  const target = `${FOLDER}/${SHA}.bookmarks.json`;
  assert.equal(files.get(target), '{"version":1}\n');
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `mkdir ${FOLDER}`);
  assert.match(
    calls[1]!,
    new RegExp(
      `^write ${FOLDER}/\\.${SHA}\\.bookmarks\\.json\\.[0-9a-f]+\\.tmp$`,
      "u",
    ),
  );
  assert.match(calls[2]!, new RegExp(`^rename .*\\.tmp ${target}$`, "u"));
});

test("writing no text removes the file, and removing a file that is not there is fine", async () => {
  const { files } = await inVault(async () => {
    await bookmarks().write(PDF, SHA, "x");
    await bookmarks().write(PDF, SHA, undefined);
    await bookmarks().write(PDF, SHA, undefined);
  });
  assert.equal(files.size, 0);
});

test("the bookmark file is watched without waking for the annotation file beside it", async () => {
  const listeners: Array<(uri: fake.Uri) => void> = [];
  const original = fake.workspace.createFileSystemWatcher;
  Object.assign(fake.workspace, {
    createFileSystemWatcher: () => ({
      onDidChange: (listener: (uri: fake.Uri) => void) => {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidCreate: () => ({ dispose: () => undefined }),
      onDidDelete: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
    }),
  });
  let changes = 0;
  try {
    await inVault(() => {
      bookmarks().watch!(PDF, SHA, () => {
        changes++;
      });
      for (const name of [`${SHA}.json`, "other.bookmarks.json"]) {
        listeners[0]!(fake.Uri.file(`${FOLDER}/${name}`));
      }
      assert.equal(changes, 0);
      listeners[0]!(fake.Uri.file(`${FOLDER}/${SHA}.bookmarks.json`));
      assert.equal(changes, 1);
    });
  } finally {
    Object.assign(fake.workspace, { createFileSystemWatcher: original });
  }
});

test("a PDF with no folder to keep files in has no bookmark file, and a write says so", async () => {
  const workspace = fake.workspace as Record<string, unknown>;
  const original = workspace["getWorkspaceFolder"];
  Object.assign(fake.workspace, { getWorkspaceFolder: () => undefined });
  try {
    // A remote file outside every folder: there is no home folder to use.
    const remote = "vscode-vfs://github/o/r/a.pdf";
    assert.equal(await bookmarks().read(remote, SHA), undefined);
    await assert.rejects(
      bookmarks().write(remote, SHA, "x"),
      /no folder to keep this PDF's bookmarks in/u,
    );
  } finally {
    Object.assign(fake.workspace, { getWorkspaceFolder: original });
  }
});
