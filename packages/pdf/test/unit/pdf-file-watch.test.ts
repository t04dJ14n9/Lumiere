import assert from "node:assert/strict";
import { test } from "node:test";
// First: files.ts imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { vscodePdfFiles } from "../../src/extension/plugins/pdf/files";

type Listener = (uri: fake.Uri) => void;

/** Watch `uri` with a watcher whose events the test fires. */
function watch(
  uri: string,
  start: (uri: string, onChange: () => void) => () => void = (
    given,
    onChange,
  ) => vscodePdfFiles.watch(given, onChange),
) {
  const listeners = { change: [] as Listener[], create: [], delete: [] } as {
    change: Listener[];
    create: Listener[];
    delete: Listener[];
  };
  let pattern: fake.RelativePattern | undefined;
  const original = fake.workspace.createFileSystemWatcher;
  Object.assign(fake.workspace, {
    createFileSystemWatcher: (given: fake.RelativePattern) => {
      pattern = given;
      const on = (kind: keyof typeof listeners) => (listener: Listener) => {
        listeners[kind].push(listener);
        return { dispose: () => undefined };
      };
      return {
        onDidChange: on("change"),
        onDidCreate: on("create"),
        onDidDelete: on("delete"),
        dispose: () => undefined,
      };
    },
  });
  let changes = 0;
  const stop = start(uri, () => {
    changes++;
  });
  Object.assign(fake.workspace, { createFileSystemWatcher: original });
  const fire = (kind: keyof typeof listeners, path: string): void => {
    for (const listener of listeners[kind]) {
      listener(fake.Uri.file(path));
    }
  };
  return { fire, changes: () => changes, pattern: () => pattern, stop };
}

test("a PDF whose name has glob characters reloads when it changes", () => {
  const { fire, changes, pattern } = watch(
    "file:///vault/papers/Smith [2020] {draft}*.pdf",
  );
  // The name is never a pattern: the folder's files are watched instead.
  assert.equal(pattern()?.pattern, "*");
  fire("change", "/vault/papers/Smith [2020] {draft}*.pdf");
  fire("create", "/vault/papers/Smith [2020] {draft}*.pdf");
  assert.equal(changes(), 2);
});

test("another file in the folder does not reload the PDF", () => {
  const { fire, changes } = watch("file:///vault/papers/a.pdf");
  fire("change", "/vault/papers/b.pdf");
  fire("change", "/vault/papers/sub/a.pdf");
  fire("create", "/vault/papers/a.pdf.tmp");
  assert.equal(changes(), 0);
});

test("a deleted PDF is noticed", () => {
  const { fire, changes } = watch("file:///vault/papers/a.pdf");
  fire("delete", "/vault/papers/a.pdf");
  assert.equal(changes(), 1);
});

test("another window's save of a PDF's annotation file is noticed", () => {
  const sha256 = "a".repeat(64);
  const original = (fake.workspace as Record<string, unknown>)
    .getWorkspaceFolder;
  Object.assign(fake.workspace, {
    getWorkspaceFolder: () => ({ uri: fake.Uri.file("/vault") }),
  });
  try {
    const { fire, changes, pattern } = watch(
      "file:///vault/papers/a.pdf",
      (uri, onChange) =>
        vscodePdfFiles.annotations!.watch!(uri, sha256, onChange),
    );
    assert.equal(pattern()?.pattern, "*");
    fire("change", `/vault/.lumiere/pdf-annotations/${sha256}.json`);
    fire("change", "/vault/.lumiere/pdf-annotations/other.json");
    fire("change", "/vault/papers/a.pdf");
    assert.equal(changes(), 1);
    assert.equal(
      vscodePdfFiles.annotations!.key!("file:///vault/papers/a.pdf", sha256),
      `file:///vault/.lumiere/pdf-annotations/${sha256}.json`,
    );
  } finally {
    Object.assign(fake.workspace, { getWorkspaceFolder: original });
  }
});
