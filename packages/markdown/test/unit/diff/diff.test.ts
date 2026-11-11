import test from "node:test";
import assert from "node:assert/strict";
import {
  alignBlocks,
  diffSequences,
  lineHunks,
  markSide,
  rowMarkdown,
  splitBlocks,
  wordDiff,
} from "../../../src/shared/diff";

function apply<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (const run of diffSequences(a, b)) {
    if (run.type === "equal") {
      assert.deepEqual(
        a.slice(run.aFrom, run.aTo),
        b.slice(run.bFrom, run.bTo),
      );
      out.push(...a.slice(run.aFrom, run.aTo));
    } else if (run.type === "insert") {
      out.push(...b.slice(run.bFrom, run.bTo));
    }
  }
  return out;
}

test("myers: random sequences rebuild the new side and keep a minimal edit count", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 300; round++) {
    const a = Array.from(
      { length: Math.floor(random() * 30) },
      () => "abcd"[Math.floor(random() * 4)]!,
    );
    const b = Array.from(
      { length: Math.floor(random() * 30) },
      () => "abcd"[Math.floor(random() * 4)]!,
    );
    assert.deepEqual(apply(a, b), b);
    // Every run covers the sequences exactly once, in order.
    let ai = 0;
    let bi = 0;
    for (const run of diffSequences(a, b)) {
      assert.equal(run.aFrom, ai);
      assert.equal(run.bFrom, bi);
      ai = run.aTo;
      bi = run.bTo;
    }
    assert.equal(ai, a.length);
    assert.equal(bi, b.length);
  }
  const edits = diffSequences([..."abcabba"], [..."cbabac"])
    .filter((r) => r.type !== "equal")
    .reduce((n, r) => n + (r.aTo - r.aFrom) + (r.bTo - r.bFrom), 0);
  assert.equal(edits, 5);
});

test("myers: past the edit cap the middle is one replacement", () => {
  const runs = diffSequences([..."aaaa"], [..."bbbb"], undefined, 2);
  assert.deepEqual(
    runs.map((r) => r.type),
    ["delete", "insert"],
  );
});

test("lineHunks: added, modified and deleted like quick diff", () => {
  const before = "a\nb\nc\nd\ne\n";
  const after = "a\nB\nc\ne\nf\n";
  assert.deepEqual(lineHunks(before, after), [
    { kind: "modified", oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 2 },
    { kind: "deleted", oldFrom: 3, oldTo: 4, newFrom: 3, newTo: 3 },
    { kind: "added", oldFrom: 5, oldTo: 5, newFrom: 4, newTo: 5 },
  ]);
  assert.deepEqual(lineHunks("x\r\ny", "x\ny"), []);
});

test("wordDiff: words change as units and a lone space joins neighbours", () => {
  assert.deepEqual(wordDiff("report it monthly.", "report it per region."), [
    { type: "equal", text: "report it " },
    { type: "delete", text: "monthly" },
    { type: "insert", text: "per region" },
    { type: "equal", text: "." },
  ]);
  assert.deepEqual(wordDiff("same", "same"), [{ type: "equal", text: "same" }]);
});

test("markSide: wraps plain runs, leaves Markdown syntax bare", () => {
  const segments = wordDiff(
    "shown as **a percentage** monthly",
    "shown as **a ratio** quarterly",
  );
  assert.equal(
    markSide(segments, "before"),
    'shown as **a <del class="mw-gd-del">percentage</del>** <del class="mw-gd-del">monthly</del>',
  );
  assert.equal(
    markSide(segments, "after"),
    'shown as **a <ins class="mw-gd-ins">ratio</ins>** <ins class="mw-gd-ins">quarterly</ins>',
  );
  const syntax = wordDiff("see [a](b)", "see [c](d)");
  assert.equal(
    markSide(syntax, "after"),
    'see [<ins class="mw-gd-ins">c</ins>](d)',
  );
  assert.equal(
    markSide(wordDiff("`a b` x", "`a c` y"), "after"),
    '`a c` <ins class="mw-gd-ins">y</ins>',
  );
});

test("splitBlocks: frontmatter, fences, math, tables and headings stay whole", () => {
  const text =
    "---\na: 1\n---\n# T\n\npara\nline\n| x |\n|---|\n| 1 |\n\n```js\n\nx\n```\n$$\ny\n$$\n";
  assert.deepEqual(
    splitBlocks(text).map((b) => [b.kind, b.from, b.to]),
    [
      ["frontmatter", 0, 3],
      ["heading", 3, 4],
      ["text", 5, 7],
      ["table", 7, 10],
      ["code", 11, 15],
      ["math", 15, 18],
    ],
  );
});

test("alignBlocks: pairs changed blocks of a kind and keeps deletions in place", () => {
  const before =
    "# T\n\nold words here\n\ngone paragraph\n\n| a |\n|---|\n| 1 |\n";
  const after = "# T\n\nnew words here\n\n| a |\n|---|\n| 2 |\n\nadded\n";
  assert.deepEqual(
    alignBlocks(before, after).map((r) => r.kind),
    ["equal", "modified", "deleted", "modified", "added"],
  );
});

test("alignBlocks: an edited block sits beside its old version, not a new neighbour", () => {
  const rows = alignBlocks(
    "P1 hello world.\n\nP2 foo bar.\n",
    "P0 brand new.\n\nP1 hello world!\n\nP2 foo bar.\n",
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.before?.text, r.after?.text]),
    [
      ["added", undefined, "P0 brand new."],
      ["modified", "P1 hello world.", "P1 hello world!"],
      ["equal", "P2 foo bar.", "P2 foo bar."],
    ],
  );
});

test("alignBlocks: a removed block before an edited one stays on its own row", () => {
  const rows = alignBlocks(
    "Alpha one two.\n\nBeta three four five.\n",
    "Beta three four five six.\n",
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.before?.text, r.after?.text]),
    [
      ["deleted", "Alpha one two.", undefined],
      ["modified", "Beta three four five.", "Beta three four five six."],
    ],
  );
});

test("alignBlocks with containers: list items align one by one", () => {
  const kinds = (before: string, after: string) =>
    alignBlocks(before, after, { containers: true }).map((r) => [
      r.kind,
      r.before?.text,
      r.after?.text,
    ]);
  assert.deepEqual(kinds("- a\n- b\n- c\n", "- a\n- new\n- b\n- c\n"), [
    ["equal", "- a", "- a"],
    ["added", undefined, "- new"],
    ["equal", "- b", "- b"],
    ["equal", "- c", "- c"],
  ]);
  // Renumbered items pair with their own text, not with their old number.
  assert.deepEqual(kinds("1. a\n2. b\n3. c\n", "1. a\n2. new\n3. b\n4. c\n"), [
    ["equal", "1. a", "1. a"],
    ["added", undefined, "2. new"],
    ["modified", "2. b", "3. b"],
    ["modified", "3. c", "4. c"],
  ]);
  // A list after a paragraph line, nested items and later paragraphs stay put.
  assert.deepEqual(
    kinds(
      "Tasks:\n- x\n  - x1\n\n    more\n- y\n",
      "Tasks:\n- x\n  - x1\n\n    more\n- w\n- y\n",
    ),
    [
      ["equal", "Tasks:", "Tasks:"],
      ["equal", "- x\n  - x1\n\n    more", "- x\n  - x1\n\n    more"],
      ["added", undefined, "- w"],
      ["equal", "- y", "- y"],
    ],
  );
});

test("rowMarkdown: code blocks diff by line as an HTML block on one line", () => {
  const [row] = alignBlocks("```\na\nb\n```", "```\na\nc\n```");
  const md = rowMarkdown(row!);
  assert.ok(!md.before!.includes("\n"));
  assert.match(md.before!, /mw-gd-line-del">b</);
  assert.match(md.after!, /mw-gd-line-ins">c</);
  assert.ok(!md.after!.includes("mw-gd-line-del"));
  assert.match(
    rowMarkdown({
      kind: "added",
      after: { kind: "code", text: "```\n<x>\n```", from: 0, to: 3 },
    }).after!,
    /&lt;x&gt;/,
  );
});

test("N2: list, task and heading prefixes, reference definitions and code spans are never wrapped", () => {
  const mark = (before: string, after: string) =>
    markSide(wordDiff(before, after), "after");
  assert.equal(mark("- old", "+ old"), "+ old");
  assert.equal(mark("1. item", "2. item"), "2. item");
  assert.equal(mark("- [ ] task", "- [x] task"), "- [x] task");
  assert.equal(mark("[id]: /old", "[id]: /new"), "[id]: /new");
  assert.equal(mark("## Old", "### Old"), "### Old");
  assert.equal(
    mark("see ``a ` b`` here", "see ``a ` c`` here"),
    "see ``a ` c`` here",
  );
  // Text after the prefix is still marked.
  assert.equal(
    mark("- old item", "- new item"),
    '- <ins class="mw-gd-ins">new</ins> item',
  );
});

test("N3: very different inputs fall back to one replacement within the trace budget", () => {
  const a = Array.from({ length: 4000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 4000 }, (_, i) => `b${i}`);
  const started = performance.now();
  const runs = diffSequences(a, b);
  assert.deepEqual(
    runs.map((run) => run.type),
    ["delete", "insert"],
  );
  assert.ok(performance.now() - started < 2000);
  // Within the budget the exact diff is unchanged.
  const c = [...a];
  c[10] = "x";
  assert.deepEqual(
    diffSequences(a, c).map((run) => run.type),
    ["equal", "delete", "insert", "equal"],
  );
});

test("R2-B2: an unmatched long backtick run does not stall highlighting", () => {
  const prefix = "prose " + "`".repeat(10_000) + "x ".repeat(50_000);
  const before = prefix + "old";
  const after = prefix + "new";
  const started = performance.now();
  const segments = wordDiff(before, after);
  const html = markSide(segments, "after");
  const elapsed = performance.now() - started;
  assert.ok(html.endsWith('<ins class="mw-gd-ins">new</ins>'), html.slice(-80));
  assert.ok(elapsed < 1500, `took ${elapsed} ms`);
});

test("R2-B2: code spans still need a closing run of the same length", () => {
  const mark = (a: string, b: string) => markSide(wordDiff(a, b), "after");
  assert.equal(mark("a ``x` old`` b", "a ``x` new`` b"), "a ``x` new`` b");
  assert.equal(
    mark("a `x` old", "a `x` new"),
    'a `x` <ins class="mw-gd-ins">new</ins>',
  );
  // An unmatched run protects nothing after it.
  assert.equal(
    mark("a ``` old", "a ``` new"),
    'a ``` <ins class="mw-gd-ins">new</ins>',
  );
});
