import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { nodeFiles } from "../../src/host/node-platform";
import {
  fileUri,
  joinUri,
  parentUri,
  uriName,
  uriPath,
} from "../../src/host/uris";

const NAMES = [
  "a.md",
  "sub/b c.md",
  "../outside.md",
  "./x/../y.md",
  "Q #1? 50%.md",
  "Café/naïve.md",
  "a+b & c=d @$,;'!()*.md",
  "Paper [draft] | v2 ~ old.md",
];

test("joining a link onto a folder URI matches path.join and pathToFileURL", () => {
  const folder = pathToFileURL("/vault/daily notes").toString();
  for (const relative of NAMES) {
    assert.equal(
      joinUri(nodeFiles, folder, relative),
      pathToFileURL(path.posix.join("/vault/daily notes", relative)).toString(),
      relative,
    );
  }
  assert.equal(
    joinUri(nodeFiles, folder, "sub/.."),
    pathToFileURL("/vault/daily notes").toString(),
  );
});

test("a URI's folder and name", () => {
  const note = pathToFileURL("/vault/daily notes/Q #1.md").toString();
  assert.equal(
    parentUri(nodeFiles, note),
    pathToFileURL("/vault/daily notes").toString(),
  );
  // `file:///` here, the current drive's root (`file:///D:/`) on Windows.
  assert.equal(
    parentUri(nodeFiles, pathToFileURL("/vault").toString()),
    pathToFileURL("/").toString(),
  );
  assert.equal(uriName(note), "Q #1.md");
});

test("a Windows drive is a root: its folder is itself, and `..` stops there", () => {
  // As the URL standard resolves them, on every platform; `/C:` alone would
  // be the drive's current folder on Windows.
  const files = { uriOf: fileUri };
  const resolved = (relative: string, base: string) =>
    new URL(relative, base).href;
  assert.equal(parentUri(files, "file:///C:/vault"), "file:///C:/");
  assert.equal(parentUri(files, "file:///C:/vault/"), "file:///C:/");
  assert.equal(parentUri(files, "file:///C:/"), "file:///C:/");
  assert.equal(parentUri(files, "file:///C:/vault/a.md"), "file:///C:/vault");
  for (const relative of ["..", "../..", "../../x.md", "a/../../../y.md"]) {
    assert.equal(
      joinUri(files, "file:///C:/vault", relative),
      resolved(relative, "file:///C:/vault/"),
      relative,
    );
  }
  assert.equal(uriName("file:///C:/vault/a.md"), "a.md");
});

// Node's own host names files with pathToFileURL (node-platform.ts), so
// the two never need to agree across Node versions; they write a few
// characters differently (Node 26 escapes ^ and |, Node 22 does not).
const SAME_AS_NODE = Number(process.versions.node.split(".")[0]) >= 26;
const pathOf = (uri: string) => decodeURIComponent(new URL(uri).pathname);

test("without Node, a path's URI is the one Node 26's pathToFileURL gives", () => {
  for (let code = 32; code < 127; code++) {
    const file = `/v/x${String.fromCharCode(code)}y.md`;
    if (!file.slice(3).includes("/")) {
      const node = pathToFileURL(file).toString();
      if (SAME_AS_NODE) {
        assert.equal(fileUri(file), node, file);
      }
      // On any Node, both name the same file.
      assert.equal(pathOf(fileUri(file)), pathOf(node), file);
      assert.equal(pathOf(fileUri(file)), file, file);
    }
  }
  assert.equal(fileUri("/v/é ü.md"), pathToFileURL("/v/é ü.md").toString());
});

test("a URI's path resolves dot segments and refuses hidden separators", () => {
  assert.equal(uriPath("file:///v/a/../b%20c.md"), "/v/b c.md");
  assert.equal(uriPath("file:///v/a/%2e%2e/b.md"), "/v/b.md");
  assert.throws(() => uriPath("file:///v/a%2F..%2F..%2Fx.md"), TypeError);
  assert.throws(() => uriPath("file:///v/a%5c..%5cx.md"), TypeError);
  assert.throws(() => uriPath("https://example.com/v/a.md"), TypeError);
});
