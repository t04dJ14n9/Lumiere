import test from "node:test";
import assert from "node:assert/strict";
import {
  githubSlug,
  noteFragment,
} from "../../../src/markdown/metadata/fragments";
import { metadata } from "../../../src/markdown/metadata";

const headingAt = (source: string, fragment: string) => {
  const range = noteFragment(source, fragment);
  return range ? source.slice(range.from).split("\n")[0] : undefined;
};

test("Obsidian: heading text matches without case, punctuation or extra spaces", () => {
  const source = "# Use Postgres\n## A/B: why?\n## C++ & more\n";
  assert.equal(headingAt(source, "use postgres"), "# Use Postgres");
  assert.equal(headingAt(source, "Use%20Postgres"), "# Use Postgres");
  // Obsidian reads `/`, `:` and `?` as spaces on both sides.
  assert.equal(headingAt(source, "A B why"), "## A/B: why?");
  assert.equal(headingAt(source, "A/B: why?"), "## A/B: why?");
  assert.equal(headingAt(source, "  c   & more "), "## C++ & more");
});

test("a % that starts no escape is read as text", () => {
  const source = "# 100% done\n";
  assert.equal(headingAt(source, "100% done"), "# 100% done");
  assert.equal(headingAt(source, "100%25%20done"), "# 100% done");
});

test("Obsidian: A#B is a deeper heading after A, not only its child", () => {
  const source = "# Top\n## Middle\n### Deep\n# Other\n### Deep\n";
  const range = noteFragment(source, "Top#Deep");
  assert.equal(range?.from, source.indexOf("### Deep"));
  // The section ends at the next heading of the same or a higher level.
  assert.equal(range?.text, "### Deep\n");
  assert.equal(
    noteFragment(source, "Other#Deep")?.from,
    source.lastIndexOf("### Deep"),
  );
  assert.equal(noteFragment(source, "Deep#Top"), undefined);
});

test("Obsidian: an earlier part's section does not bound the next part", () => {
  // Same as Obsidian's resolveSubpath: after Top, any later heading deeper
  // than Top may match Deep, even one under a later sibling of Top.
  const source = "# Top\n## OnlyHere\n# Other\n## Deep\n";
  assert.equal(
    noteFragment(source, "Top#Deep")?.from,
    source.indexOf("## Deep"),
  );
  assert.equal(
    noteFragment(source, "Other#Deep")?.from,
    source.indexOf("## Deep"),
  );
});

test("GitHub: a slug reaches its heading, as on GitHub and in VS Code", () => {
  const source = [
    "# Use Postgres",
    "## What's new?",
    "## A  B",
    "## Café ☕ notes",
    "## snake_case and-hyphen",
    "",
  ].join("\n");
  assert.equal(headingAt(source, "use-postgres"), "# Use Postgres");
  assert.equal(headingAt(source, "whats-new"), "## What's new?");
  // Each space is a hyphen; GitHub does not collapse them.
  assert.equal(headingAt(source, "a--b"), "## A  B");
  assert.equal(headingAt(source, "caf%C3%A9--notes"), "## Café ☕ notes");
  assert.equal(
    headingAt(source, "snake_case-and-hyphen"),
    "## snake_case and-hyphen",
  );
});

test("GitHub: repeated headings are reached with -1, -2", () => {
  const source = "# Notes\nfirst\n# Notes\nsecond\n# Notes\nthird\n";
  assert.equal(noteFragment(source, "notes")?.text, "# Notes\nfirst\n");
  assert.equal(noteFragment(source, "notes-1")?.text, "# Notes\nsecond\n");
  assert.equal(noteFragment(source, "notes-2")?.text, "# Notes\nthird\n");
  assert.equal(noteFragment(source, "notes-3"), undefined);
});

test("Obsidian's match wins over a GitHub slug", () => {
  // `notes-1` is the text of the third heading and the slug of the second.
  const source = "# Notes\n# Notes\n# Notes-1\n";
  assert.equal(
    noteFragment(source, "notes-1")?.from,
    source.indexOf("# Notes-1"),
  );
});

test("githubSlug follows GitHub's rules", () => {
  assert.equal(githubSlug("Hello, World!"), "hello-world");
  assert.equal(githubSlug("v1.2 — release"), "v12--release");
  assert.equal(githubSlug("Über Größe"), "über-größe");
});

test("block ids match without case, as in Obsidian", () => {
  const source = "A paragraph. ^MyBlock\n";
  assert.equal(noteFragment(source, "^myblock")?.text, "A paragraph.");
  assert.equal(noteFragment(source, "^MYBLOCK")?.text, "A paragraph.");
  assert.equal(noteFragment(source, "^other"), undefined);
});

// Obsidian's block scopes (obsidian.md/help/links#Link to a block in a note):
// an id on a list item names the item with its children, an id in a quote
// or callout names the quote, and an id on a heading names that heading.
test("a block id on a list item names the item with its bullet and children", () => {
  const source = [
    "- first",
    "- second ^item",
    "  - child",
    "    - grandchild",
    "- third",
    "",
  ].join("\n");
  assert.equal(
    noteFragment(source, "^item")?.text,
    "- second\n  - child\n    - grandchild",
  );
  const nested = ["- top", "  - nested ^deep", "    - below", "- next"].join(
    "\n",
  );
  assert.equal(noteFragment(nested, "^deep")?.text, "- nested\n  - below");
  const ordered = "1. one\n2. two ^two\n3. three\n";
  assert.equal(noteFragment(ordered, "^two")?.text, "2. two");
});

test("a block id inside a quote or callout names the whole quote", () => {
  const source = "> [!note] Title\n> First line\n> Last line ^quote\n\nAfter\n";
  assert.equal(
    noteFragment(source, "^quote")?.text,
    "> [!note] Title\n> First line\n> Last line",
  );
});

test("a block id on a heading names the heading, not the whole note", () => {
  const source = "Intro\n\n## Heading ^head\n\nBody\n";
  assert.equal(noteFragment(source, "^head")?.text, "## Heading");
});

test("an id on its own line still names the block before it", () => {
  const source = "- a\n- b\n\n^list\n\nPara\n";
  assert.equal(noteFragment(source, "^list")?.text, "- a\n- b");
});

test("a nested item indented with tabs and spaces keeps its children nested", () => {
  // `- nested` starts at column 2; its child's tab reaches column 4.
  const source = ["- top", "  - nested ^mix", "\t- child", "- next"].join("\n");
  assert.equal(noteFragment(source, "^mix")?.text, "- nested\n  - child");
  // A tab that crosses the item's column leaves the rest as spaces.
  const deeper = ["- top", "  - nested ^tab", "\t\t- child"].join("\n");
  assert.equal(noteFragment(deeper, "^tab")?.text, "- nested\n      - child");
});

test("a child task ticked through an embed of its parent item changes the source line", async () => {
  const { taskEdit } = await import("../../../src/plugins/tasks/edits");
  const source = ["- top", "  - [ ] parent ^p", "    - [ ] child", ""].join(
    "\n",
  );
  const block = metadata(source).blocks.p!;
  const embedded = block.text.split("\n");
  assert.equal(embedded[1], "  - [ ] child");
  // What the embed's checkbox sends: the block's first source line plus
  // the line within the embed, and the embedded line's text.
  const edit = taskEdit(
    source,
    block.position.start.line + 1,
    embedded[1]!,
    true,
  );
  assert.ok(edit, "the child's toggle maps back to its source line");
  assert.equal(
    source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
    ["- top", "  - [ ] parent ^p", "    - [x] child", ""].join("\n"),
  );
});
