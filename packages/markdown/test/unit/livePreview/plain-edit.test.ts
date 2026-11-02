import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import {
  headingIndex,
  sectionHeadings,
} from "../../../src/plugins/stickyScroll/model";
import {
  headingGutterClasses,
  headingLines,
} from "../../../src/plugins/lineNumbers/headings";
import { footnoteCarry } from "../../../src/plugins/footnotes/carry";
import {
  extractFootnotes,
  footnoteRegistry,
  knownFootnotes,
} from "../../../src/markdown/metadata/footnote-extract";
import { isPlainTextEdit } from "../../../src/plugins/livePreview/plain-edit";
import {
  cachedPersistentNodes,
  persistentNodesCarry,
} from "../../../src/plugins/livePreview/registry";
import { parseMarkdown } from "../../../src/markdown/dialect";
import { Text } from "@codemirror/state";

const start = EditorState.create({
  doc: "Some text here\n# Head\n- item one",
});
const edit = (changes: ChangeSpec) => start.update({ changes });

test("a word typed after text on its line is a plain edit; a line break or a block mark is not", () => {
  assert.ok(isPlainTextEdit(edit({ from: 9, insert: "more " })));
  assert.ok(isPlainTextEdit(edit({ from: 5, to: 9 })), "a deleted word");
  assert.ok(!isPlainTextEdit(edit({ from: 0, insert: "x" })), "line start");
  assert.ok(!isPlainTextEdit(edit({ from: 9, insert: "\n" })));
  assert.ok(!isPlainTextEdit(edit({ from: 14, to: 15 })), "joins lines");
  for (const mark of [
    "#",
    "=",
    "-",
    "`",
    "~",
    "$",
    "%",
    "\\",
    "<",
    ">",
    "|",
    "+",
    "*",
  ]) {
    assert.ok(!isPlainTextEdit(edit({ from: 9, insert: mark })), mark);
  }
  assert.ok(!isPlainTextEdit(start.update({})), "no change");
  // Text that turns a mark into words, or words into a mark.
  const item = EditorState.create({ doc: "  - nested\n-word\n__" });
  assert.ok(
    !isPlainTextEdit(item.update({ changes: { from: 3, insert: "word" } })),
  );
  assert.ok(
    !isPlainTextEdit(item.update({ changes: { from: 12, insert: " " } })),
  );
  assert.ok(
    !isPlainTextEdit(item.update({ changes: { from: 18, insert: "_" } })),
  );
  assert.ok(
    isPlainTextEdit(item.update({ changes: { from: 6, insert: "ly" } })),
  );
});

// Random edits on a note with every kind of block; wherever an index took
// the shortcut, it must equal a fresh walk of the whole note.
function randomNote(seed: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 40; i++) {
    parts.push(
      [
        `## Heading ${i}`,
        `Paragraph ${i} with words[^n${i % 5}] and more.`,
        `- item ${i}\n  - nested ${i}`,
        "```js\nlet a = 1;\n```",
        `Setext ${i}\n----`,
        `> quote ${i}`,
        `[^n${i % 5}]: note ${i % 5}`,
        `Text with ![[Embed ${i}]] and ![alt](img${i}.png) inline.`,
      ][(i * 3 + seed) % 8]!,
    );
  }
  return parts.join("\n\n");
}

const EMBEDS = new Set(["WikiEmbed", "Image"]);

function random(seed: number) {
  let value = seed;
  return () => (value = (value * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

const typed = [
  "a",
  "word ",
  " ",
  "x",
  "!",
  ".",
  "q",
  "!",
  "(",
  ")",
  "_",
  "1. ",
  "[",
  "^",
  "]",
  "#",
  "\n",
  "-",
  "`",
];

test("heading, gutter and footnote indexes after random edits equal a fresh walk", () => {
  let total = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const next = random(seed);
    let state = EditorState.create({
      doc: randomNote(seed),
      extensions: [
        documentTree,
        headingIndex,
        headingGutterClasses,
        footnoteCarry,
        persistentNodesCarry,
      ],
    });
    footnoteRegistry(state.doc, state.field(documentTree));
    let shortcuts = 0;
    for (let step = 0; step < 120; step++) {
      const at = Math.floor(next() * state.doc.length);
      const remove = next() < 0.25 ? Math.min(3, state.doc.length - at) : 0;
      const insert =
        remove && next() < 0.5 ? "" : typed[Math.floor(next() * typed.length)]!;
      const transaction = state.update({
        changes: { from: at, to: at + remove, insert },
      });
      if (isPlainTextEdit(transaction)) {
        shortcuts++;
      }
      state = transaction.state;
      const tree = state.field(documentTree);
      assert.deepEqual(
        state.field(headingIndex),
        sectionHeadings(state.doc, tree),
        `headings, seed ${seed} step ${step}`,
      );
      const markers = (set: ReturnType<typeof headingLines>) => {
        const out: string[] = [];
        set.between(0, state.doc.length, (from, _to, marker) => {
          out.push(`${from}:${marker.elementClass}`);
        });
        return out;
      };
      assert.deepEqual(
        markers(state.field(headingGutterClasses)),
        markers(headingLines(state)),
        `gutter, seed ${seed} step ${step}`,
      );
      const carried = knownFootnotes(state.doc);
      if (carried) {
        const fresh = extractFootnotes(state.doc, tree);
        assert.deepEqual(
          JSON.parse(JSON.stringify(carried.definitions)),
          JSON.parse(JSON.stringify(fresh.definitions)),
          `footnote definitions, seed ${seed} step ${step}`,
        );
        assert.deepEqual(
          [...carried.references].map(([at, note]) => [
            at,
            note.label,
            note.number,
          ]),
          [...fresh.references].map(([at, note]) => [
            at,
            note.label,
            note.number,
          ]),
          `footnote references, seed ${seed} step ${step}`,
        );
      }
      footnoteRegistry(state.doc, tree);
      const embeds = (
        entries: readonly { name: string; from: number; to: number }[],
      ) => entries.map(({ name, from, to }) => `${name}@${from}-${to}`);
      assert.deepEqual(
        embeds(cachedPersistentNodes(tree, EMBEDS)),
        embeds(
          cachedPersistentNodes(
            parseMarkdown(Text.of(state.doc.toString().split("\n"))),
            EMBEDS,
          ),
        ),
        `embeds, seed ${seed} step ${step}`,
      );
    }
    total += shortcuts;
  }
  assert.ok(total > 60, `${total} plain edits took the shortcut`);
});
