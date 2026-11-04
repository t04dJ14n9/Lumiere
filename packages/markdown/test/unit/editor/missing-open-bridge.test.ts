import test from "node:test";
import assert from "node:assert/strict";
import {
  basenameForIntendedFileUri,
  isFileNotFoundError,
  isMissingMarkdownFileUri,
  MissingOpenBridge,
  openBridgeForMissingMarkdown,
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

test("isFileNotFoundError matches VS Code and Node missing-file codes", () => {
  assert.equal(isFileNotFoundError({ code: "FileNotFound" }), true);
  assert.equal(isFileNotFoundError({ code: "ENOENT" }), true);
  assert.equal(isFileNotFoundError(new Error("nope")), false);
  assert.equal(isFileNotFoundError(undefined), false);
});

test("openBridgeForMissingMarkdown opens untitled then openWith Lumia and remembers mapping", async () => {
  const bridge = new MissingOpenBridge();
  const opened: string[] = [];
  const openWithCalls: unknown[] = [];
  const intended = "file:///vault/notes/test.md";
  const viewType = "lumiere.markdown.editor";

  const bridgeUri = await openBridgeForMissingMarkdown({
    intendedFileUri: intended,
    viewType,
    viewColumn: 1,
    preview: true,
    bridge,
    host: {
      async openTextDocument(uri) {
        opened.push(uri);
      },
      async openWith(uri, type, options) {
        openWithCalls.push([uri, type, options]);
      },
    },
  });

  assert.match(bridgeUri, /^untitled:/i);
  assert.match(bridgeUri, /test\.md$/i);
  assert.deepEqual(opened, [bridgeUri]);
  assert.deepEqual(openWithCalls, [
    [bridgeUri, viewType, { viewColumn: 1, preview: true }],
  ]);
  assert.equal(bridge.peek(bridgeUri), intended);
});

test("openBridgeForMissingMarkdown rejects non-markdown intended URIs", async () => {
  await assert.rejects(
    () =>
      openBridgeForMissingMarkdown({
        intendedFileUri: "file:///vault/a.ts",
        viewType: "lumiere.markdown.editor",
        bridge: new MissingOpenBridge(),
        host: {
          async openTextDocument() {},
          async openWith() {},
        },
      }),
    /markdown/i,
  );
});
