import assert from "node:assert/strict";
import test from "node:test";
import { isHtmlLinkTarget, isHtmlPath } from "../../../src/shared/html-file";

test("a file path names an HTML file by its extension alone: # and ? are part of the name", () => {
  for (const path of [
    "a.html",
    "a.htm",
    "Dir/Page.HTML",
    "C# notes.html",
    "a?b.html",
    "dir/C#/x.htm",
    "100%.html",
  ]) {
    assert.equal(isHtmlPath(path), true, path);
  }
  for (const path of [
    "a.xhtml",
    "a.html.txt",
    "a.js",
    "a.svg",
    "html",
    "a.html#x",
    "a.html?v=3",
    "a#.html.md",
    "a.md",
    "",
  ]) {
    assert.equal(isHtmlPath(path), false, path);
  }
});

test("a wikilink target stops at its first #, the subpath", () => {
  for (const target of [
    "a.html",
    "dir/a.htm",
    "a.html#gamma",
    "a.html#height=480",
    "a.html#gamma&mode=extract",
    "a?b.html",
    "100%.html",
  ]) {
    assert.equal(isHtmlLinkTarget(target, "wikilink"), true, target);
  }
  // `C# notes.html` is the file `C`, and a heading: no HTML file.
  for (const target of [
    "C# notes.html",
    "a.html.txt",
    "a.js#x.html",
    "#a.html",
  ]) {
    assert.equal(isHtmlLinkTarget(target, "wikilink"), false, target);
  }
});

test("a Markdown destination is decoded as resources decodes it: %23 stays a # of the name", () => {
  for (const target of [
    "a.html",
    "C%23%20notes.html",
    "a%3Fb.html",
    "dir/My%20page.htm",
    "a.html#gamma",
    "a?b.html",
    "100%.html",
    "a%2Ehtml",
  ]) {
    assert.equal(isHtmlLinkTarget(target, "markdown"), true, target);
  }
  for (const target of [
    "a.html%23x",
    "a.js",
    "C# notes.html",
    "a.html%2Etxt",
  ]) {
    assert.equal(isHtmlLinkTarget(target, "markdown"), false, target);
  }
  // The same text means another file as a wikilink, which is never decoded.
  assert.equal(isHtmlLinkTarget("a%2Ehtml", "wikilink"), false);
});
