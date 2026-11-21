import assert from "node:assert/strict";
import test from "node:test";
import { embedEditing, embedsNote } from "../../../src/plugins/embeds/clicks";
import { embedEstimatedHeight } from "../../../src/plugins/embeds/estimated-height";
import {
  embedsHtml,
  fenceContent,
  htmlEmbedBlockFile,
  htmlEmbedTarget,
  isHtmlEmbedFence,
  parseHtmlEmbedBlock,
} from "../../../src/plugins/embeds/html-embed-source";

test("each syntax names its HTML file, and the size beside it is read past", () => {
  // Embed HTML's sizes, and the `#height=` PDF embeds take.
  for (const source of [
    "![[a.html]]",
    "![[a.html#height=480]]",
    "![[a.html|400]]",
    "![[a.html|600x200]]",
    "![[a.html|x200]]",
    "![[a.html|-]]",
    "![[a.html|500x-]]",
    "![[a.html|height: 300px; max-width: 50%]]",
    "![[a.html#gamma&mode=extract]]",
  ]) {
    assert.equal(embedsHtml(source), true, source);
    assert.equal(htmlEmbedTarget(source)?.split("#")[0], "a.html", source);
  }
  assert.equal(htmlEmbedTarget("![[dir/a.htm|600x200]]"), "dir/a.htm");
  // In a table cell the pipe is escaped, and the file is before it.
  assert.equal(htmlEmbedTarget("![[a.html\\|600x200]]"), "a.html");
  assert.equal(htmlEmbedTarget("![alt](/p/a.html)"), "/p/a.html");
  assert.equal(
    htmlEmbedTarget("![alt|600x200](/p/a.html#height=300)"),
    "/p/a.html#height=300",
  );
});

test("an embed of anything else is no HTML embed", () => {
  for (const source of [
    "![[a.png|200]]",
    "![[Note]]",
    "![[doc.pdf#page=2]]",
    "![](a.pdf)",
    "![[a.xhtml]]",
    "![[a.html.txt]]",
    "![alt](https://host/page.js)",
    "",
  ]) {
    assert.equal(embedsHtml(source), false, source);
  }
});

test("an html-embed block names its file by file:, path:, or its first line alone", () => {
  const file = (content: string) => parseHtmlEmbedBlock(content);
  // "HTML Embed" (community.obsidian.md/plugins/html-embed): file, height, width.
  assert.equal(
    file("file: visualizations/binary-search-tree.html\nheight: 600"),
    "visualizations/binary-search-tree.html",
  );
  assert.equal(file("path: a/b.html\nwidth: 80%\nheight: 480px"), "a/b.html");
  assert.equal(file('FILE: "my page.html"'), "my page.html");
  // "Local HTML Embed": the path alone, then a height. "HTML Widget Embed": the path, then `height:`.
  assert.equal(file("examples/sample.html\n900"), "examples/sample.html");
  assert.equal(
    file("lessons/matrix-stepper.html\nheight: 470"),
    "lessons/matrix-stepper.html",
  );
  assert.equal(file("\n  a.html  \n\n 700px \n"), "a.html");
  // A Windows path has a colon, and is no vault path: the block stays code.
  assert.equal(file("C:/x/a.html"), undefined);
  // Not a file, not an HTML file, or keys alone: the block stays code.
  for (const content of [
    "",
    "height: 500",
    "width: 5\nheight: 5",
    "file: notes.md",
    "file: script.js\nheight: 5",
    "auto",
  ]) {
    assert.equal(file(content), undefined, content);
  }
});

test("a fenced block is read from its whole source, closed or not", () => {
  const source = "```html-embed\nfile: a.html\nheight: 600\n```";
  assert.equal(isHtmlEmbedFence(source), true);
  assert.equal(isHtmlEmbedFence("```HTML-EMBED\nfile: a.html"), true);
  assert.equal(isHtmlEmbedFence("~~~html-embed"), true);
  assert.equal(isHtmlEmbedFence("```html"), false);
  assert.equal(isHtmlEmbedFence("```html-embedded"), false);
  assert.equal(isHtmlEmbedFence("![[a.html]]"), false);
  assert.equal(fenceContent(source), "file: a.html\nheight: 600");
  assert.equal(fenceContent("```html-embed\nfile: a.html"), "file: a.html");
  assert.equal(htmlEmbedBlockFile(source), "a.html");
  assert.equal(htmlEmbedBlockFile("```js\nfile: a.html\n```"), undefined);
  assert.equal(embedsHtml(source), true);
  assert.equal(embedsHtml("```html-embed\nheight: 5\n```"), false);
});

test("a note reserves a card's height for every syntax, whatever size the source writes", () => {
  const card = embedEstimatedHeight("![[doc.pdf]]");
  for (const source of [
    "![[a.html]]",
    "![[a.html#height=900]]",
    "![[a.html|600x800]]",
    "![alt|600x800](/p/a.html)",
    "```html-embed\nfile: a.html\nheight: 900\n```",
  ]) {
    assert.equal(embedEstimatedHeight(source), card, source);
  }
  assert.ok(card < 120, `got ${card}`);
});

test("other embeds keep the reserve they had", () => {
  assert.ok(embedEstimatedHeight("![[Note]]") > 300);
  assert.ok(embedEstimatedHeight("![[pic.png|200x800]]") > 700);
  assert.equal(embedsHtml("```js\nfile: a.html\n```"), false);
});

test("an HTML card keeps clicks for its buttons and reveals its source from the Edit button", () => {
  for (const source of [
    "![[a.html]]",
    "![[a.html#height=480]]",
    "![[a.html|600x480]]",
    "![alt](/p/a.html)",
    "![[dir/a.htm]]",
  ]) {
    assert.equal(embedsNote(source), false, source);
    assert.equal(embedEditing(source).reveal, "button", source);
  }
});

test("a target that is not a vault file is no HTML embed: an address, or a remote page, stays what it was", () => {
  for (const source of [
    "![alt](https://host/page.html)",
    "![alt|600x200](http://host/page.html)",
    "![[https://host/page.html]]",
    "![alt](//host/page.html)",
    "![alt](file:///etc/page.html)",
    "![alt](data:text/html,<p>)",
    "![alt](javascript:alert(1)//a.html)",
    "![[C:/x/a.html]]",
  ]) {
    assert.equal(htmlEmbedTarget(source), undefined, source);
    assert.equal(embedsHtml(source), false, source);
  }
  // So it gets no HTML card's inline minimum height either: that is
  // `embedsHtml`'s (plugins/embeds/webview.ts), and an unknown remote link keeps
  // the reserve it always had.
  // A block that names an address or an absolute path stays code.
  for (const content of [
    "file: https://host/page.html",
    "path: http://host/page.html",
    "https://host/page.html\nheight: 5",
    "file: //host/page.html",
    "file: C:/x/page.html",
    "C:/x/page.html",
  ]) {
    assert.equal(parseHtmlEmbedBlock(content), undefined, content);
  }
  assert.equal(
    embedsHtml("```html-embed\nfile: https://host/page.html\n```"),
    false,
  );
  // The vault's own relative and rooted paths still are.
  for (const source of [
    "![alt](./a.html)",
    "![alt](../a.html)",
    "![alt](/a.html)",
  ]) {
    assert.equal(embedsHtml(source), true, source);
  }
});

test("an html-embed block is no note embed: it gets no note's height watching", () => {
  const block = "```html-embed\nfile: a.html\n```";
  assert.equal(embedsNote(block), false);
  assert.equal(embedsNote("```html-embed\nnot a file\n```"), false);
  // A note embed is still one.
  assert.equal(embedsNote("![[Note]]"), true);
  assert.equal(embedsNote("![[folder/Other.md]]"), true);
  assert.equal(embedEditing(block).reveal, "button");
});
