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

test("joining a template's list into an anchored one leaves the properties that alias it as they were", () => {
  const note = [
    "---",
    "tags: &labels",
    "  - work",
    "archive: *labels",
    "---",
    "Body",
    "",
  ].join("\n");
  const { text } = inserted(note, "---\ntags: [meeting]\n---\n", {
    from: note.length,
    to: note.length,
  });
  const values = frontmatter(text)?.values;
  assert.deepEqual(values?.tags, ["work", "meeting"]);
  assert.deepEqual(values?.archive, ["work"]);
});

test("joining lists keeps .inf, -.inf, .nan and null apart", () => {
  const note = [
    "---",
    "values: [.inf, -.inf, .nan, null]",
    "---",
    "Body",
    "",
  ].join("\n");
  const { text } = inserted(note, "---\nvalues: [new]\n---\n", {
    from: note.length,
    to: note.length,
  });
  const values = frontmatter(text)?.values?.values as unknown[];
  assert.equal(values.length, 5);
  assert.deepEqual(values.slice(0, 3), [Infinity, -Infinity, NaN]);
  assert.deepEqual(values.slice(3), [null, "new"]);
});

test("a long integer is never rounded by merging a template's properties", () => {
  const note = "---\nids: [18446744073709551615]\n---\nBody\n";
  // In the template: its properties are not merged rather than rounded.
  const fromTemplate = inserted(
    note,
    "---\nserial: 18446744073709551615\n---\nText\n",
    { from: note.length, to: note.length },
  );
  assert.equal(fromTemplate.invalidProperties, "template");
  assert.ok(!fromTemplate.text.includes("18446744073709552000"));
  // In the note: a list that holds one is not rewritten.
  const intoNote = inserted(note, "---\nids: [7]\n---\nText\n", {
    from: note.length,
    to: note.length,
  });
  assert.ok(intoNote.text.includes("18446744073709551615"), intoNote.text);
  assert.ok(!intoNote.text.includes("18446744073709552000"));
});

test("an empty property in the note takes the template's value", () => {
  const note = "---\ntags:\n---\nBody\n";
  const { text, invalidProperties } = inserted(
    note,
    "---\ntags: [meeting]\n---\nText\n",
    { from: note.length, to: note.length },
  );
  assert.equal(invalidProperties, undefined);
  assert.deepEqual(frontmatter(text)?.values?.tags, ["meeting"]);
});

test("a long integer reached through an alias, or in a flow header, is never rounded", () => {
  for (const note of [
    "---\nbase: &ids [18446744073709551615]\nids: *ids\n---\nBody\n",
    "---\n{ids: [1], serial: 18446744073709551615}\n---\nBody\n",
  ]) {
    const { text, invalidProperties } = inserted(
      note,
      "---\nids: [7]\n---\nText\n",
      { from: note.length, to: note.length },
    );
    assert.equal(invalidProperties, "note", note);
    assert.ok(!text.includes("18446744073709552000"), text);
  }
});
