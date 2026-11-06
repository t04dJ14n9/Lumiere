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
