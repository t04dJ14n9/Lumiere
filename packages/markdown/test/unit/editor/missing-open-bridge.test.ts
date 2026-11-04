import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  basenameForIntendedFileUri,
  isFileNotFoundError,
  isMissingMarkdownFileUri,
  MissingOpenBridge,
  openBridgeForMissingMarkdown,
  persistMissingOpenBridge,
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

test("untitledBridgeUriFor keeps the full intended path for Save association", () => {
  const bridge = untitledBridgeUriFor("file:///vault/notes/test.md");
  assert.match(bridge, /^untitled:\/vault\/notes\/test\.md$/i);
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

test("persistMissingOpenBridge writes the intended file, opens it, and clears mapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "lumia-missing-open-"));
  try {
    const intendedPath = join(root, "nested", "dir", "test.md");
    const intended = pathToFileURL(intendedPath).href;
    const bridge = new MissingOpenBridge();
    const bridgeUri = untitledBridgeUriFor(intended);
    bridge.remember(bridgeUri, intended);

    const openWithCalls: unknown[] = [];
    const closed: string[] = [];
    const content = "# hello\n";

    const written = await persistMissingOpenBridge({
      bridgeUri,
      content,
      bridge,
      viewType: "lumiere.markdown.editor",
      host: {
        async ensureParentDir(fileUri) {
          await mkdir(dirname(fileURLToPath(fileUri)), { recursive: true });
        },
        async writeText(fileUri, text) {
          await writeFile(fileURLToPath(fileUri), text, "utf8");
        },
        async openWith(uri, type, options) {
          openWithCalls.push([uri, type, options]);
        },
        async closeUri(uri) {
          closed.push(uri);
        },
      },
    });

    assert.equal(written, intended);
    assert.equal(await readFile(intendedPath, "utf8"), content);
    assert.equal((await stat(intendedPath)).isFile(), true);
    assert.equal(bridge.peek(bridgeUri), undefined);
    assert.deepEqual(openWithCalls, [
      [intended, "lumiere.markdown.editor", undefined],
    ]);
    assert.deepEqual(closed, [bridgeUri]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistMissingOpenBridge is a no-op when the bridge is not mapped", async () => {
  const result = await persistMissingOpenBridge({
    bridgeUri: "untitled:/ghost.md",
    content: "x",
    bridge: new MissingOpenBridge(),
    viewType: "lumiere.markdown.editor",
    host: {
      async ensureParentDir() {
        throw new Error("should not run");
      },
      async writeText() {
        throw new Error("should not run");
      },
      async openWith() {
        throw new Error("should not run");
      },
      async closeUri() {
        throw new Error("should not run");
      },
    },
  });
  assert.equal(result, undefined);
});
