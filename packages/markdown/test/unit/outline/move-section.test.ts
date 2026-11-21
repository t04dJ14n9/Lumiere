import test from "node:test";
import assert from "node:assert/strict";
import { moveSectionEdit } from "../../../src/plugins/outline/move-section";

/** The note after moving the section of `heading` before `before` (or to the end). */
function moved(text: string, heading: string, before?: string) {
  const edit = moveSectionEdit(text, {
    heading: text.indexOf(heading),
    beforeHeading: before === undefined ? undefined : text.indexOf(before),
  });
  return edit && text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

const NOTE = [
  "# A",
  "a text",
  "",
  "## A1",
  "a1 text",
  "",
  "# B",
  "b text",
  "",
  "# C",
  "c text",
  "",
].join("\n");

test("a section moves up before the heading it is dropped on, with its subheadings", () => {
  assert.equal(
    moved(NOTE, "# B", "# A"),
    "# B\nb text\n\n# A\na text\n\n## A1\na1 text\n\n# C\nc text\n",
  );
  assert.equal(
    moved(NOTE, "# C", "# B"),
    "# A\na text\n\n## A1\na1 text\n\n# C\nc text\n\n# B\nb text\n\n",
  );
});

test("a section moves down, and below the last row to the end of the note", () => {
  assert.equal(
    moved(NOTE, "# A", "# C"),
    "# B\nb text\n\n# A\na text\n\n## A1\na1 text\n\n# C\nc text\n",
  );
  assert.equal(
    moved(NOTE, "# A"),
    "# B\nb text\n\n# C\nc text\n\n# A\na text\n\n## A1\na1 text\n\n",
  );
});

test("a heading keeps its level wherever it lands, as in Obsidian", () => {
  assert.equal(
    moved(NOTE, "## A1", "# A"),
    "## A1\na1 text\n\n# A\na text\n\n# B\nb text\n\n# C\nc text\n",
  );
  assert.equal(
    moved(NOTE, "## A1", "# C"),
    "# A\na text\n\n# B\nb text\n\n## A1\na1 text\n\n# C\nc text\n",
  );
});

test("a section without a blank line before the next heading gets one, and so does the text before it", () => {
  const tight = "# A\na\n# B\nb\n# C\nc";
  assert.equal(moved(tight, "# C", "# B"), "# A\na\n\n# C\nc\n\n# B\nb\n");
  assert.equal(moved(tight, "# A"), "# B\nb\n# C\nc\n\n# A\na\n\n");
});

test("a section moved to the top of the note does not start with blank lines", () => {
  assert.equal(
    moved("# A\na\n\n# B\nb\n", "# B", "# A"),
    "# B\nb\n\n# A\na\n\n",
  );
});

test("dropping inside the dragged section or right after it changes nothing", () => {
  assert.equal(moved(NOTE, "# A", "# A"), undefined);
  assert.equal(moved(NOTE, "# A", "## A1"), undefined);
  assert.equal(moved(NOTE, "# A", "# B"), undefined);
  assert.equal(moved(NOTE, "# C"), undefined);
  // A subsection dropped on the heading after its parent's section is
  // already there.
  assert.equal(moved(NOTE, "## A1", "# B"), undefined);
});

test("offsets that are not headings change nothing", () => {
  assert.equal(
    moveSectionEdit(NOTE, { heading: 1, beforeHeading: undefined }),
    undefined,
  );
  assert.equal(
    moveSectionEdit(NOTE, { heading: 0, beforeHeading: 2 }),
    undefined,
  );
});

test("a `#` line in a code block is not a heading and does not end a section", () => {
  const text = "# A\n```\n# not a heading\n```\n\n# B\nb\n";
  assert.equal(
    moved(text, "# B", "# A"),
    "# B\nb\n\n# A\n```\n# not a heading\n```\n\n",
  );
});

test("the edit replaces only the span that changed", () => {
  const edit = moveSectionEdit(NOTE, {
    heading: NOTE.indexOf("# C"),
    beforeHeading: NOTE.indexOf("# B"),
  });
  assert.ok(edit);
  assert.equal(edit.from, NOTE.indexOf("# B") + 2);
  assert.equal(NOTE.slice(0, edit.from), "# A\na text\n\n## A1\na1 text\n\n# ");
});
