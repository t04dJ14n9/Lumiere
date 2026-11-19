import assert from "node:assert/strict";
import { test } from "node:test";
// First: files.ts imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { vscodePdfFiles } from "../../src/extension/plugins/pdf/files";

type Listener = (uri: fake.Uri) => void;

/** Watch `uri` with a watcher whose events the test fires. */
function watch(uri: string) {
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
  const stop = vscodePdfFiles.watch(uri, () => {
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
