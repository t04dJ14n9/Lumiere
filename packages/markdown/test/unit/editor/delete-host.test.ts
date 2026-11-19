import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";
import type * as DeletionsModule from "../../../src/host/services/deletions";
import type { AfterDelete } from "../../../src/shared/host";
import { forgetModules } from "../../support/module-cache";

const uri = (value: string) => ({ toString: () => value });
type Files = { files: { toString(): string }[] };

/** `deletions.ts` against fake VS Code deletion events. */
function setup() {
  let willListener:
    | ((event: Files & { waitUntil(p: Promise<unknown>): void }) => void)
    | undefined;
  let didListener: ((event: Files) => void) | undefined;
  const disposed: string[] = [];
  const fakeVscode = {
    workspace: {
      onWillDeleteFiles(listener: typeof willListener) {
        willListener = listener;
        return { dispose: () => disposed.push("will") };
      },
      onDidDeleteFiles(listener: typeof didListener) {
        didListener = listener;
        return { dispose: () => disposed.push("did") };
      },
    },
  };
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? fakeVscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  // Each test brings its own fake: load the module again for it.
  forgetModules(require, "/src/host/services/deletions");
  let onWillDelete: typeof DeletionsModule.onWillDelete;
  try {
    ({ onWillDelete } = require("../../../src/host/services/deletions.ts"));
  } finally {
    loader._load = originalLoad;
  }
  return {
    onWillDelete,
    disposed,
    /** VS Code deletes `files`: asks the participants, then deletes. */
    async delete(files: string[], { fails = false } = {}) {
      const waiting: Promise<unknown>[] = [];
      willListener!({
        files: files.map(uri),
        waitUntil: (promise) => void waiting.push(promise),
      });
      await Promise.all(waiting);
      if (!fails) {
        didListener!({ files: files.map(uri).reverse() });
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("the listener plans while the files exist and its step runs after they are gone", async () => {
  const host = setup();
  const log: string[] = [];
  host.onWillDelete((uris) => {
    log.push(`plan ${uris.join(",")}`);
    return () => void log.push("after");
  });
  await host.delete(["file:///a.md", "file:///b.md"]);
  assert.deepEqual(log, ["plan file:///a.md,file:///b.md", "after"]);
});

test("a deletion that fails never runs its step, and a listener with no step is fine", async () => {
  const host = setup();
  const steps: string[] = [];
  const answers: (AfterDelete | undefined)[] = [
    () => void steps.push("failed one"),
    undefined,
  ];
  host.onWillDelete(() => answers.shift());
  await host.delete(["file:///a.md"], { fails: true });
  await host.delete(["file:///b.md"]);
  assert.deepEqual(steps, []);
});

test("stopping the listener stops both events", () => {
  const host = setup();
  host.onWillDelete(() => undefined)();
  assert.deepEqual(host.disposed.sort(), ["did", "will"]);
});
