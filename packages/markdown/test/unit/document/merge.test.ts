import test from "node:test";
import assert from "node:assert/strict";
import {
  diskChangeConflicts,
  mergeDiskChange,
} from "../../../src/shared/document/merge";

const merge = (saved: string, buffer: string, disk: string) =>
  mergeDiskChange({ saved, buffer, disk });

test("a disk that still holds the saved text leaves the buffer alone", () => {
  assert.equal(merge("a\nb", "a\nB", "a\nb"), "a\nB");
});

test("a buffer that holds the saved text takes the disk", () => {
  assert.equal(merge("a\nb", "a\nb", "a\nB\nc"), "a\nB\nc");
});

test("a buffer that already equals the disk is the merge", () => {
  assert.equal(merge("a\nb", "A\nb", "A\nb"), "A\nb");
});

test("changes in different places both survive", () => {
  assert.equal(merge("a\nb\nc\nd", "A\nb\nc\nd", "a\nb\nc\nD"), "A\nb\nc\nD");
});

test("changes on neighbouring lines both survive", () => {
  assert.equal(merge("a\nb\nc", "A\nb\nc", "a\nB\nc"), "A\nB\nc");
});

test("a line added by each side, in different places, both survive", () => {
  assert.equal(
    merge("a\nb\nc", "mine\na\nb\nc", "a\nb\nc\ntheirs"),
    "mine\na\nb\nc\ntheirs",
  );
});

test("lines inserted by each side at one place are both kept, the user's first", () => {
  assert.equal(
    merge("a\nb", "a\nmine\nb", "a\ntheirs\nb"),
    "a\nmine\ntheirs\nb",
  );
});

test("the same text inserted by both sides is kept once", () => {
  assert.equal(merge("a\nb", "a\nnew\nb", "a\nnew\nb\nend"), "a\nnew\nb\nend");
});

test("the same change made by both sides is applied once", () => {
  assert.equal(
    merge("a\nb\nc", "a\nB\nc\nmine", "a\nB\nc\ntheirs"),
    "a\nB\nc\nmine\ntheirs",
  );
});

test("both sides changing the same line keeps the user's line", () => {
  assert.equal(merge("a\nb\nc", "a\nmine\nc", "a\ntheirs\nc"), "a\nmine\nc");
});

test("a line the user changed and the disk deleted keeps the user's line", () => {
  assert.equal(merge("a\nb\nc", "a\nB\nc", "a\nc"), "a\nB\nc");
});

test("a conflict does not stop the disk's other changes from landing", () => {
  assert.equal(
    merge("a\nb\nc\nd", "a\nmine\nc\nd", "a\ntheirs\nc\nD"),
    "a\nmine\nc\nD",
  );
});

test("a deletion by the disk and an edit elsewhere by the user both apply", () => {
  assert.equal(merge("a\nb\nc\nd", "a\nb\nc\nD", "a\nc\nd"), "a\nc\nD");
});

test("a note without a final newline gains the disk's appended lines", () => {
  assert.equal(merge("a\nb", "A\nb", "a\nb\nc"), "A\nb\nc");
});

test("carriage returns are kept as written", () => {
  assert.equal(
    merge("a\r\nb\r\nc", "A\r\nb\r\nc", "a\r\nb\r\nC"),
    "A\r\nb\r\nC",
  );
});

test("empty texts merge", () => {
  assert.equal(merge("", "mine", ""), "mine");
  assert.equal(merge("", "", "theirs"), "theirs");
  assert.equal(merge("a", "", "a\nb"), "\nb");
});

test("a large file with one change on each side merges", () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
  const edit = (at: number) => lines.map((l, i) => (i === at ? `${l}!` : l));
  const merged = merge(
    lines.join("\n"),
    edit(100).join("\n"),
    edit(4000).join("\n"),
  );
  const expected = lines.map((l, i) => (i === 100 || i === 4000 ? `${l}!` : l));
  assert.equal(merged, expected.join("\n"));
});

test("edits and deletions on different lines always all survive", () => {
  let seed = 7;
  const random = (below: number) => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed % below;
  };
  for (let round = 0; round < 300; round++) {
    const base = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const ours = [...base];
    const theirs = [...base];
    const expected = [...base];
    // Every line has at most one owner, so no two changes clash.
    for (let i = 0; i < base.length; i++) {
      const owner = random(3);
      const deleted = random(4) === 0;
      const side = owner === 0 ? ours : owner === 1 ? theirs : undefined;
      if (!side) {
        continue;
      }
      const value = deleted ? undefined : `${base[i]} (${owner})`;
      side[i] = value as string;
      expected[i] = value as string;
    }
    const join = (lines: (string | undefined)[]) =>
      lines.filter((line) => line !== undefined).join("\n");
    assert.equal(
      merge(join(base), join(ours), join(theirs)),
      join(expected),
      `round ${round}`,
    );
    assert.equal(
      conflicts(join(base), join(ours), join(theirs)),
      false,
      `round ${round}`,
    );
  }
});

const conflicts = (saved: string, buffer: string, disk: string) =>
  diskChangeConflicts({ saved, buffer, disk });

test("only a change both sides made differently to the same lines conflicts", () => {
  assert.equal(conflicts("a\nb\nc", "a\nmine\nc", "a\ntheirs\nc"), true);
  assert.equal(conflicts("a\nb\nc", "A\nb\nc", "a\nb\nC"), false);
  assert.equal(conflicts("a\nb\nc", "A\nb\nc", "a\nB\nc"), false);
  assert.equal(conflicts("a\nb", "a\nmine\nb", "a\ntheirs\nb"), false);
  assert.equal(conflicts("a\nb", "a\nB", "a\nB"), false);
  assert.equal(conflicts("a\nb\nc", "a\nc", "a\nB\nc"), true);
  assert.equal(conflicts("a\nb", "A\nb", "a\nb"), false);
  assert.equal(conflicts("a\nb", "a\nb", "A\nb"), false);
});
