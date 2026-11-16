import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../../../src/markdown/html";
import { markdownParser } from "../../../src/markdown/dialect";
import { metadata } from "../../../src/markdown/metadata";

const { renderMarkdown } = createRenderer();

/** The text of the note the editor's parser leaves outside `%%` comments. */
function editorVisible(text: string): string {
  const hidden: [number, number][] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name === "ObsidianComment") {
        hidden.push([node.from, node.to]);
        return false;
      }
      return undefined;
    },
  });
  let visible = "";
  let at = 0;
  for (const [from, to] of hidden) {
    visible += text.slice(at, from);
    at = to;
  }
  return visible + text.slice(at);
}

function headings(text: string): string[] {
  return metadata(text).headings.map((heading) => heading.heading);
}

test("the editor ends a paragraph at a %% line, and the comment at its close", () => {
  const note = "Intro\n%%\ndraft\n\n%%\n\nVisible\n\n# Visible heading";
  assert.equal(editorVisible(note), "Intro\n\n\nVisible\n\n# Visible heading");
  assert.deepEqual(headings(note), ["Visible heading"]);
  const midLine = "Intro %%\ndraft\n%%\n\n# H";
  assert.equal(editorVisible(midLine), "Intro \n\n# H");
  assert.deepEqual(headings(midLine), ["H"]);
});

test("the editor parses the text after a block comment's closing %%", () => {
  const note = "%%\nhidden\n%% visible after [[Link]] #tag ^id\n\nnext";
  assert.equal(editorVisible(note), " visible after [[Link]] #tag ^id\n\nnext");
  const parsed = metadata(note);
  assert.deepEqual(
    parsed.links.map((link) => link.link),
    ["Link"],
  );
  assert.deepEqual(
    parsed.tags.map((tag) => tag.tag),
    ["tag"],
  );
  assert.ok(parsed.blocks.id, "the ^id after the comment is a block id");
});

test("the editor ends an unclosed %% with its quote, as the reading view does", () => {
  const note = "> %% c\n> d\n\nafter quote\n\n# H";
  assert.ok(editorVisible(note).includes("after quote"));
  assert.deepEqual(headings(note), ["H"]);
  assert.match(renderMarkdown(note), /<h1 [^>]*>H<\/h1>/);
});

test("a %% line indented under a nested list item is a comment in both parsers, ending with the item", () => {
  const note = "- a\n    - b\n\n      %% c\n\n# H";
  assert.deepEqual(headings(note), ["H"]);
  assert.equal(editorVisible(note).includes("%% c"), false);
  const html = renderMarkdown(note);
  assert.doesNotMatch(html, /%%/);
  assert.match(html, /<h1 [^>]*>H<\/h1>/);
});

test("a literal %% in inline code or escaped does not open a comment that hides what follows", () => {
  for (const literal of ["`%%` is a marker", "\\%% is a marker"]) {
    const note = `${literal}\n%%\nhidden\n\n%%\n# Public\n\nPublic body`;
    assert.ok(!editorVisible(note).includes("hidden"), literal);
    assert.ok(editorVisible(note).includes("Public body"), literal);
    assert.deepEqual(headings(note), ["Public"], literal);
    const html = renderMarkdown(note);
    assert.ok(!html.includes("hidden"), literal);
    assert.ok(html.includes("Public body"), literal);
  }
});

test("a %% inside inline math, a tag or a wikilink does not open a comment", () => {
  for (const literal of ["$%%$", "<span title='%%'>x</span>", "[[a%%b]]"]) {
    const note = `${literal}\n%%\nhidden\n%%\n# Public\n\nPublic body`;
    assert.ok(!editorVisible(note).includes("hidden"), literal);
    assert.deepEqual(headings(note), ["Public"], literal);
    const html = renderMarkdown(note);
    assert.ok(!html.includes("hidden"), literal);
    assert.ok(html.includes("Public body"), literal);
  }
});
