import test from "node:test";
import assert from "node:assert/strict";
import { vaultScope } from "./choose";
import { collectNotes, indexCompleteness, PARTIAL_FILE_COUNT } from "./collect";
import { selectScope } from "./scope";
import type { GraphScope } from "./scope";
import type { GraphNote } from "./project";

const scope = (name: string): GraphScope =>
  vaultScope({ index: { root: `file:///vaults/${name}` } });

test("a vault scope is named after its folder", () => {
  assert.deepEqual(scope("personal"), {
    id: encodeURIComponent("file:///vaults/personal"),
    name: "personal",
    vaultRoot: "file:///vaults/personal",
  });
});

test("an open graph keeps its vault until the user asks", () => {
  assert.equal(
    selectScope({
      explicit: false,
      hasCurrent: true,
      choices: [scope("a"), scope("b")],
    }).kind,
    "keep",
  );
});

test("the active note's vault is used without a workspace guess", () => {
  const owner = scope("a");
  assert.deepEqual(
    selectScope({
      explicit: false,
      hasCurrent: false,
      owner,
      choices: [owner, scope("b")],
    }),
    { kind: "use", scope: owner },
  );
});

test("with no active note, several vaults ask and none is empty", () => {
  assert.equal(
    selectScope({
      explicit: false,
      hasCurrent: false,
      choices: [scope("a"), scope("b")],
    }).kind,
    "ask",
  );
  assert.deepEqual(
    selectScope({ explicit: false, hasCurrent: false, choices: [] }),
    { kind: "empty" },
  );
});

test("one vault is used when nothing is open yet", () => {
  const only = scope("only");
  assert.deepEqual(
    selectScope({ explicit: false, hasCurrent: false, choices: [only] }),
    { kind: "use", scope: only },
  );
});

test("choosing a vault asks even when only one is open", () => {
  assert.equal(
    selectScope({
      explicit: true,
      hasCurrent: true,
      owner: scope("only"),
      choices: [scope("only")],
    }).kind,
    "ask",
  );
});

test("index completeness distinguishes a full vault from a missing parse", () => {
  assert.equal(indexCompleteness(PARTIAL_FILE_COUNT, false), "partial");
  assert.equal(indexCompleteness(3, true), "indexing");
  assert.equal(indexCompleteness(3, false), "ready");
});

test("collectNotes includes every markdown note in the vault", () => {
  const notesByPath = new Map<string, GraphNote["metadata"]>([
    ["a.md", undefined],
    ["wiki/b.md", undefined],
    ["pic.png", undefined],
  ]);
  const vault = {
    index: {
      files: () =>
        [...notesByPath.keys()].map((path) => ({
          path,
          extension: path.endsWith(".md") ? "md" : "png",
        })),
      metadata: (path: string) => notesByPath.get(path),
    },
  };
  const collected = collectNotes(vault as never);
  assert.deepEqual(collected.notes.map((note) => note.path).sort(), [
    "a.md",
    "wiki/b.md",
  ]);
});
