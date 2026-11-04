import test from "node:test";
import assert from "node:assert/strict";
import {
  basenameForIntendedFileUri,
  isMissingMarkdownFileUri,
  MissingOpenBridge,
  untitledBridgeUriFor,
} from "../../../src/host/missing-open-bridge";

test("isMissingMarkdownFileUri accepts file Markdown paths only", () => {
  assert.equal(isMissingMarkdownFileUri("file:///vault/test.md"), true);
  assert.equal(isMissingMarkdownFileUri("file:///vault/Note.markdown"), true);
  assert.equal(isMissingMarkdownFileUri("file:///vault/a.ts"), false);
  assert.equal(isMissingMarkdownFileUri("untitled:test.md"), false);
  assert.equal(isMissingMarkdownFileUri("git:/vault/Note.md"), false);
});

test("basenameForIntendedFileUri returns the intended tab title", () => {
  assert.equal(
    basenameForIntendedFileUri("file:///vault/notes/test.md"),
    "test.md",
  );
  assert.equal(
    basenameForIntendedFileUri("file:///vault/Deep%20Note.markdown"),
    "Deep Note.markdown",
  );
});

test("untitledBridgeUriFor path ends with the intended basename", () => {
  const bridge = untitledBridgeUriFor("file:///vault/notes/test.md");
  assert.match(bridge, /^untitled:/i);
  assert.match(bridge, /test\.md$/i);
  assert.equal(basenameForIntendedFileUri(bridge), "test.md");
});

test("MissingOpenBridge remembers and takes the intended file URI", () => {
  const bridge = new MissingOpenBridge();
  const bridgeUri = untitledBridgeUriFor("file:///vault/test.md");
  const intended = "file:///vault/test.md";
  bridge.remember(bridgeUri, intended);
  assert.equal(bridge.peek(bridgeUri), intended);
  assert.equal(bridge.take(bridgeUri), intended);
  assert.equal(bridge.peek(bridgeUri), undefined);
  assert.equal(bridge.take(bridgeUri), undefined);
});

test("MissingOpenBridge clear drops a remembered mapping", () => {
  const bridge = new MissingOpenBridge();
  const bridgeUri = untitledBridgeUriFor("file:///vault/a.md");
  bridge.remember(bridgeUri, "file:///vault/a.md");
  bridge.clear(bridgeUri);
  assert.equal(bridge.peek(bridgeUri), undefined);
});

test("MissingOpenBridge rejects remembering a non-markdown intended URI", () => {
  const bridge = new MissingOpenBridge();
  assert.throws(
    () =>
      bridge.remember(
        untitledBridgeUriFor("file:///vault/a.md"),
        "file:///vault/a.ts",
      ),
    /markdown/i,
  );
});
