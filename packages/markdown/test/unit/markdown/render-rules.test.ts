import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../../../src/markdown/html";
const { renderMarkdown } = createRenderer();

test("callout aliases, fallback kinds and fold flags preserve distinct containers", () => {
  const result = renderMarkdown(
    "> [!tldr]+ Summary\n> Body\n\n> [!unknown]-\n> Other",
  );
  // Obsidian keeps the written alias in data-callout, so snippets that
  // select [data-callout="tldr"] match; the alias's colours come from CSS.
  assert.match(result, /<details class="callout" data-callout="tldr" open>/);
  assert.match(
    result,
    /<summary class="callout-title"><span class="callout-title-text">Summary<\/span><button type="button" class="callout-fold" aria-label="Toggle callout">›<\/button><\/summary>/,
  );
  assert.match(result, /<details class="callout" data-callout="unknown">/);
  assert.match(
    result,
    /<summary class="callout-title"><span class="callout-title-text">Unknown<\/span><button type="button" class="callout-fold" aria-label="Toggle callout">›<\/button><\/summary>/,
  );
  assert.equal((result.match(/<\/details>/g) ?? []).length, 2);
});

// Obsidian 1.15.0's callout syntax, read from its app.js with REA
// (2026-11-07): the type is any text but `]`, lowercased with its spaces as
// hyphens; what follows a `|` is metadata, which CSS snippets select on.
test("a callout's type may be any text, with metadata after a |, as in Obsidian", () => {
  assert.match(
    renderMarkdown("> [!note|wide] Title\n> Body"),
    /<aside class="callout" data-callout="note" data-callout-metadata="wide"><div class="callout-title"><span class="callout-title-text">Title<\/span>/,
  );
  assert.match(
    renderMarkdown("> [!My Type]\n> Body"),
    /<aside class="callout" data-callout="my-type"><div class="callout-title"><span class="callout-title-text">My type<\/span>/,
  );
  assert.match(
    renderMarkdown("> [!笔记]\n> 内容"),
    /<aside class="callout" data-callout="笔记"><div class="callout-title"><span class="callout-title-text">笔记<\/span>/,
  );
  assert.match(
    renderMarkdown('> [!a"b|c"<d]\n> Body'),
    /data-callout="a&quot;b" data-callout-metadata="c&quot;&lt;d"/,
  );
  assert.doesNotMatch(renderMarkdown("> [!note]text\n> Body"), /callout/);
});

test("a callout type that names an Object.prototype member is written as typed", () => {
  assert.match(
    renderMarkdown("> [!constructor]\n> Body"),
    /<aside class="callout" data-callout="constructor">/,
  );
  assert.match(
    renderMarkdown("> [!__proto__]\n> Body"),
    /<aside class="callout" data-callout="__proto__">/,
  );
});

test("a callout whose type is followed by any Unicode space still opens, as in Obsidian", () => {
  assert.match(
    renderMarkdown("> [!note]\u00a0Title\n> Body"),
    /<aside class="callout" data-callout="note"><div class="callout-title"><span class="callout-title-text">Title<\/span>/,
  );
  assert.match(
    renderMarkdown("> [!note]\u3000Title\n> Body"),
    /<aside class="callout" data-callout="note"><div class="callout-title"><span class="callout-title-text">Title<\/span>/,
  );
  assert.match(
    renderMarkdown("> [!note]\u00a0\n> Body"),
    /<aside class="callout" data-callout="note"><div class="callout-title"><span class="callout-title-text">Note<\/span>/,
  );
});

test("an untitled callout of a hyphenated type reads as words, as in Obsidian", () => {
  assert.match(
    renderMarkdown("> [!unknown-type]\n> Body"),
    /class="callout-title"><span class="callout-title-text">Unknown type<\/span><\/div>/,
  );
});

test("math delimiters and paragraph block IDs retain literal boundary behavior", () => {
  assert.match(
    renderMarkdown("$$\na + b\n$$"),
    /data-math="a%20%2B%20b" data-display="true"/,
  );
  assert.doesNotMatch(renderMarkdown("$ spaced $"), /math-placeholder/);
  assert.doesNotMatch(renderMarkdown("$$ unclosed"), /math-placeholder/);
  assert.match(
    renderMarkdown("Paragraph ^known-id"),
    /<p id="block-known-id">Paragraph<\/p>/,
  );
  assert.equal(renderMarkdown("^standalone").trim(), "");
});
