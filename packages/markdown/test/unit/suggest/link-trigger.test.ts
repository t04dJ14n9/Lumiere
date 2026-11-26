import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { linkTrigger } from "../../../src/markdown/link-trigger";
import { linkSuggestion } from "../../../src/plugins/links/suggestions";

test("what follows [[ asks for notes, headings or blocks, and where accepting replaces", () => {
  assert.deepEqual(linkTrigger("see [[Targ"), {
    kind: "link",
    query: "Targ",
    from: 6,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[["), {
    kind: "link",
    query: "",
    from: 2,
    closeLink: true,
  });
  // Spaces and folders belong to the query.
  assert.deepEqual(linkTrigger("[[Folder/Target No"), {
    kind: "link",
    query: "Folder/Target No",
    from: 2,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[[Target Note#Sec"), {
    kind: "heading",
    query: "Sec",
    note: "Target Note",
    from: 14,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[[#Sec"), {
    kind: "heading",
    query: "Sec",
    note: "",
    from: 3,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[[Target Note#^ab"), {
    kind: "block",
    query: "ab",
    note: "Target Note",
    from: 15,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[[^^body"), {
    kind: "block",
    query: "body",
    from: 2,
    closeLink: true,
  });
});

test("[[Note^ lists blocks with the # to come, and an alias keeps the note offered", () => {
  assert.deepEqual(linkTrigger("[[Note^ab"), {
    kind: "block",
    query: "ab",
    note: "Note",
    bare: true,
    from: 6,
    closeLink: true,
  });
  assert.deepEqual(linkTrigger("[[Note|an alias"), {
    kind: "link",
    query: "Note",
    from: 15,
    closeLink: true,
    keepTyped: true,
  });
});

test("only an unfinished link on the line opens a list", () => {
  for (const before of [
    "",
    "[",
    "plain text",
    "[[Done]]",
    "[[Done]] and then",
  ]) {
    assert.equal(linkTrigger(before), undefined, before);
  }
  // The last `[[` is the one being typed.
  assert.equal(linkTrigger("[[Broken [[")?.query, "");
});

test("the editor's trigger is this one on the caret's line, in document offsets", () => {
  const doc = "first line\n\nsee [[Target Note#Sec";
  const state = EditorState.create({ doc });
  const line = state.doc.line(3);
  const trigger = linkTrigger("see [[Target Note#Sec")!;
  assert.deepEqual(linkSuggestion({ state, pos: doc.length }), {
    ...trigger,
    from: line.from + trigger.from,
  });
  assert.equal(linkSuggestion({ state, pos: 5 }), undefined);
});

test("the owner's text: [progress](progress.md#Entries asks for that note's headings", () => {
  const before = "[progress](progress.md#Entries";
  assert.deepEqual(linkTrigger(before), {
    kind: "heading",
    query: "Entries",
    note: "progress.md",
    from: before.length - "Entries".length,
    closeLink: true,
    destination: "relative",
  });
  assert.equal(before.slice(linkTrigger(before)!.from), "Entries");
});

test("[text]( asks for notes, and what is typed after it filters them", () => {
  assert.deepEqual(linkTrigger("[progress]("), {
    kind: "link",
    query: "",
    from: 11,
    closeLink: true,
    destination: "relative",
  });
  assert.deepEqual(linkTrigger("see [a](Target"), {
    kind: "link",
    query: "Target",
    from: 8,
    closeLink: true,
    destination: "relative",
  });
  // The link text may be empty, hold brackets, or be an image.
  for (const before of [
    "[](Tar",
    "[a [b] c](Tar",
    "[![alt](pic.png)](Tar",
    "![alt](Tar",
    "- [x] [a](Tar",
  ]) {
    const trigger = linkTrigger(before);
    assert.equal(trigger?.kind, "link", before);
    assert.equal(before.slice(trigger!.from), "Tar", before);
  }
});

test("a typed destination is read decoded, while where accepting replaces stays on the text", () => {
  const before = "[x](Target%20Note.md#Second%20Se";
  assert.deepEqual(linkTrigger(before), {
    kind: "heading",
    query: "Second Se",
    note: "Target Note.md",
    from: before.indexOf("#") + 1,
    closeLink: true,
    destination: "relative",
  });
  assert.equal(before.slice(linkTrigger(before)!.from), "Second%20Se");
  assert.equal(
    linkTrigger("[x](Folder%2fTarget%20No")?.query,
    "Folder/Target No",
  );
  // A broken escape is kept as typed.
  assert.equal(linkTrigger("[x](50%2")?.query, "50%2");
});

test("a destination with # asks for the file's headings, ^ for its blocks, and a bare # for this note's", () => {
  assert.deepEqual(linkTrigger("[x](#Sec"), {
    kind: "heading",
    query: "Sec",
    note: "",
    from: 5,
    closeLink: true,
    destination: "relative",
  });
  assert.deepEqual(linkTrigger("[x](#"), {
    kind: "heading",
    query: "",
    note: "",
    from: 5,
    closeLink: true,
    destination: "relative",
  });
  assert.deepEqual(linkTrigger("[x](Note.md#^ab"), {
    kind: "block",
    query: "ab",
    note: "Note.md",
    from: 13,
    closeLink: true,
    destination: "relative",
  });
  assert.deepEqual(linkTrigger("[x](#^"), {
    kind: "block",
    query: "",
    note: "",
    from: 6,
    closeLink: true,
    destination: "relative",
  });
});

test("a path starting with /, ./ or ../ is matched by its name, and / reads from the vault root", () => {
  assert.deepEqual(linkTrigger("[x](/wiki/projects/Pro"), {
    kind: "link",
    query: "wiki/projects/Pro",
    from: 4,
    closeLink: true,
    destination: "root",
  });
  assert.equal(linkTrigger("[x](./Pro")?.query, "Pro");
  assert.equal(linkTrigger("[x](../Other/Pro")?.query, "Other/Pro");
  assert.equal(linkTrigger("[x](../../")?.query, "");
  assert.equal(linkTrigger("[x](..")?.query, "");
  // The note keeps its prefix: it says where to look.
  const heading = linkTrigger("[x](../B/progress.md#En");
  assert.equal(heading?.note, "../B/progress.md");
  assert.equal(heading?.destination, "relative");
  assert.equal(linkTrigger("[x](/a/b.md#En")?.destination, "root");
});

test("no list for web and other schemes, finished or spaced destinations, or text that is not a link", () => {
  for (const before of [
    "[x](https://exa",
    "[x](http:",
    "[x](mailto:me@",
    "[x](obsidian://open?vault=",
    // A destination ends at a space (a title may follow) or a parenthesis.
    "[x](Note.md ",
    '[x](Note.md "ti',
    "[x](Note.md)",
    "[x](Note.md) and (Tar",
    "[x](<My Note",
    // Not a link: no text before it, or a wikilink and a parenthesis.
    "plain (text",
    "f](Tar",
    "[[Note]](Tar",
    "\\](Tar",
    "[x\\](Tar",
  ]) {
    assert.equal(linkTrigger(before), undefined, before);
  }
});

test("a wikilink still wins when both could be read, and the nearer opening is the one typed", () => {
  assert.equal(linkTrigger("[a](b.md) and [[Ta")?.destination, undefined);
  assert.equal(linkTrigger("[a](b.md) and [[Ta")?.query, "Ta");
  assert.equal(linkTrigger("[[Done]] then [a](Ta")?.destination, "relative");
});

test("the editor's trigger for a destination is the caret's line, in document offsets", () => {
  const doc = "first line\n\nsee [progress](progress.md#Entries";
  const state = EditorState.create({ doc });
  const line = state.doc.line(3);
  const trigger = linkTrigger("see [progress](progress.md#Entries")!;
  assert.deepEqual(linkSuggestion({ state, pos: doc.length }), {
    ...trigger,
    from: line.from + trigger.from,
  });
  assert.equal(state.sliceDoc(line.from + trigger.from, doc.length), "Entries");
});
