import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { parseMarkdown, markdownParser } from "../../../src/markdown/dialect";
import { footnoteDefinitions } from "../../../src/markdown/metadata/footnote-definitions";
import { collectFootnoteCandidates } from "../../../src/markdown/metadata/footnote-candidates";
import {
  definitionPosition,
  extractFootnotes,
} from "../../../src/markdown/metadata/footnote-extract";

test("definition segments map continuations across blank lines without borrowing following prose", () => {
  const source = "[^a]: first\n    second\n\n  third\nNext paragraph";
  const document = Text.of(source.split("\n"));
  const [note] = footnoteDefinitions(document, parseMarkdown(document));
  assert.equal(note!.text, "first\nsecond\n\nthird");
  for (const word of ["first", "second", "third"]) {
    assert.equal(
      definitionPosition(note!.segments, note!.text.indexOf(word)),
      source.indexOf(word),
    );
  }
  assert.equal(note!.to, source.indexOf("\nNext"));
  assert.equal(
    definitionPosition(note!.segments, note!.text.length + 1),
    undefined,
  );
});

test("candidate collection drops unmappable ranges and duplicate definitions retain last-label resolution", () => {
  const text = "First[^a] and ^[inline]";
  const candidates = collectFootnoteCandidates({
    text,
    syntax: markdownParser.parse(text),
    definitions: [],
    position: (at) => (at < text.indexOf("^[") ? at + 100 : undefined),
  });
  assert.deepEqual(candidates, [{ from: 105, to: 109, label: "a" }]);
  const source = "Reference[^a]\n\n[^a]: first\n[^a]: last";
  const registry = extractFootnotes(Text.of(source.split("\n")));
  assert.equal(registry.references.get(source.indexOf("[^a]"))!.text, "last");
  assert.equal(registry.definitions[0]!.number, undefined);
  assert.equal(registry.definitions[1]!.number, 1);
});

test("footnotes are kept per document and shared with the note's metadata", async () => {
  const { footnotes } =
    await import("../../../src/markdown/metadata/footnotes");
  const { metadata } = await import("../../../src/markdown/metadata/index");
  const doc = Text.of(["A[^a] and B[^b].", "", "[^a]: one", "[^b]: two"]);
  const registry = footnotes(doc);
  assert.equal(footnotes(doc), registry, "once per document");
  assert.deepEqual(
    registry.definitions.map((note) => [note.label, note.number]),
    [
      ["a", 1],
      ["b", 2],
    ],
  );
  // Live Preview draws references from `footnotes` alone; the rest of the
  // metadata, when something asks for it, reuses the same registry.
  assert.equal(metadata(doc).footnotes, registry);
  const edited = Text.of(["A[^b] and B[^a].", "", "[^a]: one", "[^b]: two"]);
  assert.notEqual(footnotes(edited), registry, "a new document, new numbers");
  assert.equal(footnotes(edited).references.get(1)?.label, "b");
});

test("a tree of the note's start is enough for its references, with no parse of the whole note", async () => {
  const { footnoteRegistry } =
    await import("../../../src/markdown/metadata/footnote-extract");
  const lines = ["First[^b] then[^a].", ""];
  for (let i = 0; i < 400; i++) {
    lines.push(`Filler paragraph ${i} with **bold** text.`, "");
  }
  lines.push("[^a]: alpha", "[^b]: beta");
  const doc = Text.of(lines);
  const prefix = markdownParser.parse(doc.sliceString(0, 200));
  const parse = markdownParser.parse;
  let parsed = 0;
  markdownParser.parse = ((...args: Parameters<typeof parse>) => {
    parsed++;
    return parse.apply(markdownParser, args);
  }) as typeof parse;
  try {
    const partial = footnoteRegistry(doc, prefix);
    assert.equal(parsed, 0, "the whole note is not parsed");
    // Numbered in order of first reference; definitions found further down.
    assert.equal(partial.references.get(5)?.label, "b");
    assert.equal(partial.references.get(5)?.number, 1);
    assert.equal(partial.references.get(14)?.label, "a");
    assert.equal(partial.references.get(14)?.number, 2);
    assert.equal(partial.definitions.length, 2);
    assert.equal(footnoteRegistry(doc, prefix), partial, "kept for that tree");
  } finally {
    markdownParser.parse = parse;
  }
  // The whole tree, once there, makes the document's own registry.
  const whole = footnoteRegistry(doc, markdownParser.parse(doc.toString()));
  assert.equal(whole.references.get(5)?.number, 1);
  assert.equal(footnoteRegistry(doc), whole);
});
