import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHtmlViewerRequest,
  viewerTitle,
} from "../../../src/plugins/htmlViewer/request";

const ROOT = "file:///home/reader/vault";
const FILE = `${ROOT}/wiki/assets/diagram.html`;

test("the open command takes an HTML file, its vault and a column", () => {
  assert.deepEqual(parseHtmlViewerRequest([FILE, ROOT]), {
    uri: FILE,
    root: ROOT,
  });
  assert.deepEqual(parseHtmlViewerRequest([FILE, ROOT, { viewColumn: 2 }]), {
    uri: FILE,
    root: ROOT,
    column: 2,
  });
  assert.equal(
    parseHtmlViewerRequest([FILE, ROOT, { viewColumn: -2 }])?.column,
    -2,
  );
  assert.equal(
    parseHtmlViewerRequest([`${ROOT}/a%20b.HTM`, ROOT])?.uri,
    `${ROOT}/a%20b.HTM`,
  );
});

test("a file whose name has a # or a ? is an HTML file: the path is the decoded name", () => {
  for (const name of ["C%23%20notes.html", "a%3Fb.htm", "dir/a%23.HTML"]) {
    assert.deepEqual(parseHtmlViewerRequest([`${ROOT}/${name}`, ROOT]), {
      uri: `${ROOT}/${name}`,
      root: ROOT,
    });
  }
  // `a.html#x` is a file named so (its extension is `html#x`), and no HTML file.
  assert.equal(parseHtmlViewerRequest([`${ROOT}/a.html%23x`, ROOT]), undefined);
  assert.equal(viewerTitle(`${ROOT}/C%23%20notes.html`), "C# notes.html");
});

test("anything else a caller passes is refused, not guessed at", () => {
  for (const args of [
    [],
    [FILE],
    [FILE, 3],
    [{ path: FILE }, ROOT],
    [null, ROOT],
    [`${ROOT}/notes/a.md`, ROOT],
    [`${ROOT}/script.js`, ROOT],
    [`${ROOT}/a.html.txt`, ROOT],
    ["not a uri", ROOT],
    [FILE, "not a uri"],
    [FILE, ""],
    [`${FILE}${"x".repeat(9000)}`, ROOT],
    [FILE, ROOT, { viewColumn: 99 }],
    [FILE, ROOT, { viewColumn: -3 }],
    [FILE, ROOT, { viewColumn: 1.5 }],
    [FILE, ROOT, { viewColumn: "2" }],
  ]) {
    assert.equal(parseHtmlViewerRequest(args), undefined, JSON.stringify(args));
  }
});

test("the tab is titled with the file's name", () => {
  assert.equal(viewerTitle(FILE), "diagram.html");
  assert.equal(viewerTitle(`${ROOT}/a%20b.html`), "a b.html");
});
