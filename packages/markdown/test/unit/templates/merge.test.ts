import assert from "node:assert/strict";
import test from "node:test";
import { templateInsertion } from "../../../src/markdown/template-insert";
import { frontmatter } from "../../../src/markdown/properties";

function inserted(
  note: string,
  template: string,
  selection: { from: number; to: number },
) {
  const result = templateInsertion(note, template, selection);
  const text = [...result.edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.from) + edit.insert + current.slice(edit.to),
      note,
    );
  return { ...result, text };
}

const template = [
  "---",
  "tags:",
  "  - meeting",
  "status: draft",
  "created: 2026-11-16",
  "---",
  "## Agenda",
  "",
].join("\n");

test("a template's properties join the note's: values kept, keys added, lists joined", () => {
  const note = [
    "---",
    "tags:",
    "  - work",
    "status: done",
    "---",
    "Intro",
    "",
  ].join("\n");
  const caret = note.length;
  const {
    text,
    invalidProperties,
    caret: after,
  } = inserted(note, template, {
    from: caret,
    to: caret,
  });
  assert.equal(invalidProperties, undefined);
  assert.deepEqual(frontmatter(text)?.values, {
    tags: ["work", "meeting"],
    status: "done",
    created: "2026-11-16",
  });
  assert.ok(text.endsWith("Intro\n## Agenda\n"), text);
  assert.equal(text.match(/^---$/gm)?.length, 2);
  assert.equal(text.slice(after - "## Agenda\n".length, after), "## Agenda\n");
});

test("a caret at the top of a note with properties puts the body below them", () => {
  const note = ["---", "status: done", "---", "Body"].join("\n");
  const { text } = inserted(note, template, { from: 0, to: 0 });
  assert.deepEqual(frontmatter(text)?.values, {
    status: "done",
    tags: ["meeting"],
    created: "2026-11-16",
  });
  assert.ok(text.includes("---\n## Agenda\nBody"), text);
});

test("a note without properties gets the template's block at its top", () => {
  const note = "First line\n";
  const caret = note.length;
  const { text, caret: after } = inserted(note, template, {
    from: caret,
    to: caret,
  });
  assert.equal(
    text,
    [
      "---",
      "tags:",
      "  - meeting",
      "status: draft",
      "created: 2026-11-16",
      "---",
      "First line",
      "## Agenda",
      "",
    ].join("\n"),
  );
  assert.equal(after, text.length);
  const empty = inserted("", template, { from: 0, to: 0 });
  assert.equal(empty.text, template);
  assert.equal(empty.caret, template.length);
});

test("a template without properties is inserted as it is", () => {
  const note = ["---", "a: 1", "---", "x"].join("\n");
  const { text } = inserted(note, "Plain {{x}}", { from: 14, to: 14 });
  assert.equal(text, ["---", "a: 1", "---", "xPlain {{x}}"].join("\n"));
});

test("a note whose properties are not valid YAML gets only the body", () => {
  const note = ["---", "a: [", "---", "x"].join("\n");
  const caret = note.length;
  const result = inserted(note, template, { from: caret, to: caret });
  assert.equal(result.invalidProperties, "note");
  assert.equal(result.text, `${note}## Agenda\n`);
});

test("a note that ends at its closing --- keeps it a line of its own", () => {
  const note = ["---", "a: 1", "---"].join("\n");
  const caret = note.length;
  const merged = inserted(note, "---\nb: 2\n---\nHello", {
    from: caret,
    to: caret,
  });
  assert.equal(merged.text, ["---", "a: 1", "b: 2", "---", "Hello"].join("\n"));
  assert.deepEqual(frontmatter(merged.text)?.values, { a: 1, b: 2 });
  assert.equal(merged.caret, merged.text.length);
  const plain = inserted(note, "Hello", { from: caret, to: caret });
  assert.equal(plain.text, ["---", "a: 1", "---", "Hello"].join("\n"));
});

test("a template whose properties are not valid YAML gets only its body in, never its fences", () => {
  const note = "Intro\n";
  const caret = note.length;
  const result = inserted(note, "---\ntitle: [draft] plan\n---\nHello", {
    from: caret,
    to: caret,
  });
  assert.equal(result.invalidProperties, "template");
  assert.equal(result.text, "Intro\nHello");
});

test("joining a block list keeps its style and comments", () => {
  const note = [
    "---",
    "tags: # my tags",
    "  - work # first",
    "  - home",
    "status: done # keep",
    "---",
    "Body",
    "",
  ].join("\n");
  const caret = note.length;
  const { text } = inserted(note, "---\ntags:\n  - meeting\n  - work\n---\n", {
    from: caret,
    to: caret,
  });
  assert.equal(
    text,
    [
      "---",
      "tags: # my tags",
      "  - work # first",
      "  - home",
      "  - meeting",
      "status: done # keep",
      "---",
      "Body",
      "",
    ].join("\n"),
  );
});

test("an object in both lists is written once", () => {
  const note = "---\nitems:\n  - name: a\n---\n";
  const caret = note.length;
  const { text } = inserted(
    note,
    "---\nitems:\n  - name: a\n  - name: b\n---\n",
    { from: caret, to: caret },
  );
  assert.deepEqual(frontmatter(text)?.values, {
    items: [{ name: "a" }, { name: "b" }],
  });
});
