import test from "node:test";
import assert from "node:assert/strict";
import { rewriteLinks } from "../../../src/plugins/linkUpdates/rewrite";
import type { RewriteContext } from "../../../src/plugins/linkUpdates/rewrite";
import { memoryVaults } from "../views/fakes";

/** Apply edits (line/col) to text, last first. */
function apply(text: string, edits: ReturnType<typeof rewriteLinks>): string {
  const lines = text.split("\n");
  const offset = (point: { line: number; col: number }) =>
    lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) +
    point.col;
  return [...edits]
    .sort((a, b) => offset(b.start) - offset(a.start))
    .reduce(
      (result, edit) =>
        result.slice(0, offset(edit.start)) +
        edit.text +
        result.slice(offset(edit.end)),
      text,
    );
}

function context(
  notes: Record<string, string>,
  renames: Record<string, string>,
  format: RewriteContext["format"] = "shortest",
): RewriteContext {
  const { index } = memoryVaults(notes);
  const map = new Map(Object.entries(renames));
  return {
    renames: map,
    resolve: (linkpath, source) => index.resolveLink(linkpath, source)?.path,
    pathsAfter: index.files().map((file) => map.get(file.path) ?? file.path),
    format,
  };
}

const vault = {
  "Old.md": "",
  "Other.md": "",
  "pic.png": "",
  "sub/Deep.md": "",
};

test("links to a renamed note keep their form, subpath and alias", () => {
  const text = [
    "---",
    'up: "[[Old]]"',
    "---",
    "[[Old]] [[Old#Part|shown]] ![[Old#^block]] [x](Old.md#Part) [[Other]]",
  ].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New Name.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      "---",
      'up: "[[New Name]]"',
      "---",
      "[[New Name]] [[New Name#Part|shown]] ![[New Name#^block]] [x](New%20Name.md#Part) [[Other]]",
    ].join("\n"),
  );
});

test("an attachment keeps its extension; formats follow the setting", () => {
  const text = "![[pic.png]] [[Old]]";
  const renames = { "pic.png": "assets/photo.png", "Old.md": "sub/Moved.md" };
  const notes = { ...vault, "A.md": text };
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", context(notes, renames))),
    "![[photo.png]] [[Moved]]",
  );
  assert.equal(
    apply(
      text,
      rewriteLinks(text, "A.md", context(notes, renames, "absolute")),
    ),
    "![[assets/photo.png]] [[sub/Moved]]",
  );
  assert.equal(
    apply(
      text,
      rewriteLinks(
        text,
        "notes/A.md",
        context({ ...vault, "notes/A.md": text }, renames, "relative"),
      ),
    ),
    "![[../assets/photo.png]] [[../sub/Moved]]",
  );
});

test("a name that becomes ambiguous is written as a path", () => {
  const text = "[[Old]]";
  const ctx = context(
    { ...vault, "A.md": text },
    { "Old.md": "archive/Other.md" },
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[[archive/Other]]",
  );
});

test("a moved note rewrites its own path-style links, not bare names", () => {
  const text = "[[./Other]] [[sub/Deep]] [[Other]]";
  const ctx = context(
    { ...vault, "A.md": text },
    { "A.md": "sub/A.md" },
    "relative",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[[../Other]] [[Deep]] [[Other]]",
  );
});

test("an escaped pipe in a table row stays escaped", () => {
  const text = "| [[Old\\|shown]] | [[Old#Part\\|x]] |\n| - | - |";
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "| [[New\\|shown]] | [[New#Part\\|x]] |\n| - | - |",
  );
});

test("a Markdown link keeps its angle brackets and its title", () => {
  const text = [
    "[a](<Old.md#Some Part>)",
    '[b](Old.md "Title")',
    "[c](<Old.md> 'single')",
  ].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New (1).md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      "[a](<New (1).md#Some Part>)",
      '[b](New%20(1).md "Title")',
      "[c](<New (1).md> 'single')",
    ].join("\n"),
  );
});

test("a renamed note in angle brackets with parentheses is replaced whole", () => {
  const text = "[a](<Old (b).md>) after";
  const notes = { "Old (b).md": "", "A.md": text };
  const ctx = context(notes, { "Old (b).md": "New.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[a](<New.md>) after",
  );
});

test("a bare destination encodes backslashes as well as spaces", () => {
  const text = "[a](Old.md)";
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "a\\b c.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[a](a%5Cb%20c.md)",
  );
});

// Obsidian 1.15.0's rule for link text on rename, read from its link
// updater with REA (2026-11-07).
test("text showing the renamed file's name follows it; the writer's own text stays", () => {
  const text = [
    "[Old](Old.md) [ Old ](Old.md) [Old\u00A0](Old.md) [mine](Old.md)",
    "[sub/Deep](sub/Deep.md) [[sub/Deep|Deep]] [[sub/Deep|mine]]",
    "[[Old|Old]] [[sub/Deep\\|Deep]] ![pic.png](pic.png)",
  ].join("\n");
  const ctx = context(
    { ...vault, "A.md": text },
    {
      "Old.md": "New.md",
      "sub/Deep.md": "lib/Deeper.md",
      "pic.png": "photo.png",
    },
    "absolute",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      "[New](New.md) [New](New.md) [New](New.md) [mine](New.md)",
      "[lib/Deeper](lib/Deeper.md) [[lib/Deeper|Deeper]] [[lib/Deeper|mine]]",
      // Without a folder in the link, Obsidian keeps a wikilink's alias.
      "[[New|Old]] [[lib/Deeper\\|Deeper]] ![photo.png](photo.png)",
    ].join("\n"),
  );
});

test("a bare destination may hold a literal quote, as the parser reads it", () => {
  const text = '[a](Old"note.md) [b](Old"note.md "Title")';
  const notes = { 'Old"note.md': "", "A.md": text };
  const ctx = context(notes, { 'Old"note.md': "New.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    '[a](New.md) [b](New.md "Title")',
  );
});

test("a title with escaped quotes survives a rename", () => {
  const text = [
    '[a](Old.md "Say \\"hello\\"")',
    "[b](Old.md 'it\\'s')",
    '[c](<Old.md> "Say \\"hello\\"")',
  ].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New (1).md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      '[a](New%20(1).md "Say \\"hello\\"")',
      "[b](New%20(1).md 'it\\'s')",
      '[c](<New (1).md> "Say \\"hello\\"")',
    ].join("\n"),
  );
});

test("a moved note's own links keep their text", () => {
  const text = "[sub/Deep](sub/Deep.md)";
  const ctx = context(
    { ...vault, "A.md": text },
    { "A.md": "notes/A.md" },
    "relative",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[sub/Deep](../sub/Deep.md)",
  );
});

test("links that do not touch a renamed file are left alone", () => {
  const text = "[[Other]] [[Missing]] [web](https://example.com)";
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New.md" });
  assert.deepEqual(rewriteLinks(text, "A.md", ctx), []);
});
