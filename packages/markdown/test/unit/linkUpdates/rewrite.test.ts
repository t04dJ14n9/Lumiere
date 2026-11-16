import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../../src/markdown/metadata";
import {
  linkpathOf,
  vaultLinks,
} from "../../../src/markdown/metadata/linkpaths";
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
    resolve: (linkpath, source, syntax) =>
      index.resolveLink(linkpath, source, syntax)?.path,
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

test("a bare destination encodes the parentheses that have no partner", () => {
  const text = "[a](Old.md)";
  const written = {
    "New).md": "[a](New%29.md)",
    "New(.md": "[a](New%28.md)",
    "a (1) b).md": "[a](a%20(1)%20b%29.md)",
    ")a(.md": "[a](%29a%28.md)",
  };
  for (const [name, link] of Object.entries(written)) {
    const ctx = context({ ...vault, "A.md": text }, { "Old.md": name });
    const result = apply(text, rewriteLinks(text, "A.md", ctx));
    assert.equal(result, link);
    // The parser reads the written link back as a link to the new name.
    assert.deepEqual(vaultLinks(metadata(result)).map(linkpathOf), [name]);
  }
});

test("a # in a new name is written %23, so the link reads back to that file", () => {
  const text = "[a](Old.md) [b](Old.md#Part) [c](<Old.md#Part>)";
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "a#b.md" });
  const result = apply(text, rewriteLinks(text, "A.md", ctx));
  assert.equal(result, "[a](a%23b.md) [b](a%23b.md#Part) [c](<a%23b.md#Part>)");
  const { index } = memoryVaults({ "A.md": result, "a#b.md": "" });
  assert.deepEqual(Object.fromEntries(index.resolvedLinks("A.md")), {
    "a#b.md": 3,
  });
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

test("a dot in a wikilink's note name is not an extension when its alias follows", () => {
  const text = [
    "[[sub/Report.v1|Report]] [[sub/Report.v1|Report.v1]] [[sub/Report.v1\\|Report.v1]]",
    "[[sub/Old|Old]] [Old](sub/Old.md) [[sub/pic.png|pic.png]]",
  ].join("\n");
  const notes = {
    "sub/Report.v1.md": "",
    "sub/Old.md": "",
    "sub/pic.png": "",
    "A.md": text,
  };
  const ctx = context(
    notes,
    {
      "sub/Report.v1.md": "lib/Final.md",
      "sub/Old.md": "lib/New.v2.md",
      "sub/pic.png": "lib/photo.v2.png",
    },
    "absolute",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      "[[lib/Final|Report]] [[lib/Final|Final]] [[lib/Final\\|Final]]",
      "[[lib/New.v2|New.v2]] [New.v2](lib/New.v2.md) [[lib/photo.v2.png|photo.v2.png]]",
    ].join("\n"),
  );
});

test("link text written from a new name escapes brackets and backslashes", () => {
  const text = "[Old](Old.md) ![Old](Old.md) [sub/Deep](sub/Deep.md)";
  const ctx = context(
    { ...vault, "A.md": text },
    { "Old.md": "a[b]\\c.md", "sub/Deep.md": "lib/De]ep.md" },
    "absolute",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    "[a\\[b\\]\\\\c](a[b]%5Cc.md) ![a\\[b\\]\\\\c](a[b]%5Cc.md) [lib/De\\]ep](lib/De]ep.md)",
  );
});

test("link text escaped by one rename follows the next rename", () => {
  const text = "[Old](Old.md) [sub/Deep](sub/Deep.md)";
  const firstRenames = {
    "Old.md": "a[b]\\c.md",
    "sub/Deep.md": "lib/De]ep.md",
  };
  const escaped = apply(
    text,
    rewriteLinks(
      text,
      "A.md",
      context({ ...vault, "A.md": text }, firstRenames, "absolute"),
    ),
  );
  const notes = { "a[b]\\c.md": "", "lib/De]ep.md": "", "A.md": escaped };
  const secondRenames = {
    "a[b]\\c.md": "Final.md",
    "lib/De]ep.md": "lib/Last.md",
  };
  assert.equal(
    apply(
      escaped,
      rewriteLinks(escaped, "A.md", context(notes, secondRenames, "absolute")),
    ),
    "[Final](Final.md) [lib/Last](lib/Last.md)",
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

test("a parenthesized title with an escaped parenthesis survives a rename", () => {
  const text = [
    "[a](Old.md (a\\)b))",
    "[b](Old.md (a\\(b))",
    "[c](Old.md (ab))",
    "[d](<Old.md> (a\\)b))",
  ].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "New.md" });
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    [
      "[a](New.md (a\\)b))",
      "[b](New.md (a\\(b))",
      "[c](New.md (ab))",
      "[d](<New.md> (a\\)b))",
    ].join("\n"),
  );
});

test("a link to a file with # in its name follows that file, not the name before the #", () => {
  const text = "See [ch](chapter%231.md) and [x](chapter.md)";
  const notes = {
    "Index.md": text,
    "chapter.md": "",
    "chapter#1.md": "",
  };
  assert.equal(
    apply(
      text,
      rewriteLinks(
        text,
        "Index.md",
        context(notes, { "chapter.md": "renamed.md" }),
      ),
    ),
    "See [ch](chapter%231.md) and [x](renamed.md)",
  );
  assert.equal(
    apply(
      text,
      rewriteLinks(
        text,
        "Index.md",
        context(notes, { "chapter#1.md": "second.md" }),
      ),
    ),
    "See [ch](second.md) and [x](chapter.md)",
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

test("a rename to a name with quotes keeps every frontmatter style valid", async () => {
  const { parseDocument } = await import("yaml");
  const text = [
    "---",
    "single: '[[Old]]'",
    'double: "[[Old]]"',
    "plain: see [[Old]] here",
    "list:",
    "  - '[[Old]]'",
    '  - "[[Old|shown]]"',
    "  - see [[Old]]",
    "flow: ['[[Old]]', \"[[Old]]\"]",
    "---",
    "[[Old]]",
  ].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": `It's "q".md` });
  const result = apply(text, rewriteLinks(text, "A.md", ctx));
  const yaml = result.split("---")[1]!;
  const document = parseDocument(yaml);
  assert.deepEqual(document.errors, []);
  const link = `[[It's "q"]]`;
  assert.deepEqual(document.toJS(), {
    single: link,
    double: link,
    plain: `see ${link} here`,
    list: [link, `[[It's "q"|shown]]`, `see ${link}`],
    flow: [link, link],
  });
  // Quoted values keep their quoting; the body is written as it is.
  assert.match(result, /^single: '\[\[It''s "q"\]\]'$/m);
  assert.match(result, /^double: "\[\[It's \\"q\\"\]\]"$/m);
  assert.match(result, /\n\[\[It's "q"\]\]$/);
});

test("a link to a name with an apostrophe in a single-quoted value is found and rewritten", () => {
  const text = ["---", "up: '[[Bob''s]]'", "---", ""].join("\n");
  const ctx = context(
    { ...vault, "Bob's.md": "", "A.md": text },
    { "Bob's.md": "Bob.md" },
  );
  assert.equal(
    apply(text, rewriteLinks(text, "A.md", ctx)),
    ["---", "up: '[[Bob]]'", "---", ""].join("\n"),
  );
});

test("a plain value that cannot hold the new name is written double-quoted", async () => {
  const { parse } = await import("yaml");
  const text = ["---", "up: see [[Old]]", "---", ""].join("\n");
  const ctx = context({ ...vault, "A.md": text }, { "Old.md": "a #b: c.md" });
  const result = apply(text, rewriteLinks(text, "A.md", ctx));
  assert.equal(result, ["---", 'up: "see [[a #b: c]]"', "---", ""].join("\n"));
  assert.deepEqual(parse(result.split("---")[1]!), { up: "see [[a #b: c]]" });
});

test("a relative link to a note beside a root note of the same name keeps ./ and reads back", () => {
  const text = "[[Old]] [o](Old.md)";
  const notes = { "X.md": "", "notes/Old.md": "", "notes/Src.md": text };
  const ctx = context(notes, { "notes/Old.md": "notes/X.md" }, "relative");
  const result = apply(text, rewriteLinks(text, "notes/Src.md", ctx));
  assert.equal(result, "[[./X]] [o](./X.md)");
  const { index } = memoryVaults({
    "X.md": "",
    "notes/X.md": "",
    "notes/Src.md": result,
  });
  for (const link of vaultLinks(metadata(result))) {
    assert.equal(
      index.resolveLink(linkpathOf(link)!, "notes/Src.md")?.path,
      "notes/X.md",
    );
  }
  // With no root note of that name, the bare name is enough.
  const alone = context(
    { "notes/Old.md": "", "notes/Src.md": text },
    { "notes/Old.md": "notes/X.md" },
    "relative",
  );
  assert.equal(
    apply(text, rewriteLinks(text, "notes/Src.md", alone)),
    "[[X]] [o](X.md)",
  );
});
