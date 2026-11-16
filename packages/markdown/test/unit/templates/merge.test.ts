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
    isMerged,
    caret: after,
  } = inserted(note, template, {
    from: caret,
    to: caret,
  });
  assert.equal(isMerged, true);
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
  assert.equal(result.isMerged, false);
  assert.equal(result.text, `${note}## Agenda\n`);
});
