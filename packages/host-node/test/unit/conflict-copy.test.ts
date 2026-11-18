import test from "node:test";
import assert from "node:assert/strict";
import {
  conflictCopyUri,
  writeConflictCopy,
} from "../../src/host/conflict-copy";

test("a conflict copy sits beside the note, numbered after the first", () => {
  assert.equal(
    conflictCopyUri("file:///v/My%20Note.md", 1),
    "file:///v/My%20Note%20(conflict).md",
  );
  assert.equal(
    conflictCopyUri("file:///v/a.b/Note.md", 3),
    "file:///v/a.b/Note%20(conflict%203).md",
  );
  assert.equal(
    conflictCopyUri("file:///v/README", 1),
    "file:///v/README%20(conflict)",
  );
});

test("a conflict copy never overwrites a file already there", async () => {
  const existing = new Set(["file:///v/Note%20(conflict).md"]);
  const saved = new Map<string, string>();
  const copy = await writeConflictCopy(
    {
      create: async (uri) => {
        if (existing.has(uri)) {
          return false;
        }
        existing.add(uri);
        return true;
      },
      save: async (uri, text) => {
        saved.set(uri, text);
      },
    },
    "file:///v/Note.md",
    "theirs",
  );
  assert.equal(copy, "file:///v/Note%20(conflict%202).md");
  assert.deepEqual([...saved], [[copy, "theirs"]]);
});
