import test from "node:test";
import assert from "node:assert/strict";
import {
  githubSlug,
  noteFragment,
} from "../../../src/markdown/metadata/fragments";

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
