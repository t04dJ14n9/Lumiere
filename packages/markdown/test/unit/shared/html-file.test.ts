import assert from "node:assert/strict";
import test from "node:test";
import { isHtmlFile } from "../../../src/shared/html-file";

test("an HTML file is named by its extension alone, ignoring a query or subpath", () => {
  for (const name of [
    "a.html",
    "a.htm",
    "Dir/Page.HTML",
    "a.html#height=480",
    "a.html#gamma",
    "a.htm?v=3",
  ]) {
    assert.equal(isHtmlFile(name), true, name);
  }
  for (const name of [
    "a.xhtml",
    "a.html.txt",
    "a.js",
    "a.svg",
    "html",
    "a#.html",
    "a.md",
    "",
  ]) {
    assert.equal(isHtmlFile(name), false, name);
  }
});
