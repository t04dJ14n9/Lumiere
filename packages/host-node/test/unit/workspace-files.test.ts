import assert from "node:assert/strict";
import test from "node:test";
import type { HostFiles } from "../../src/host/platform";
import { createWorkspaceFiles } from "../../src/host/workspace";

/**
 * Files as host-web keeps them: `save` replaces a file and refuses a
 * missing one, as the HostFiles contract allows; `create` makes one.
 */
function strictFiles() {
  const texts = new Map<string, string>();
  const files = {
    isInside: (root: string, uri: string) => uri.startsWith(`${root}/`),
    contain: async () => {},
    uriOf: (path: string) => `file://${path}`,
    mkdir: async () => {},
    create: async (uri: string) => {
      if (texts.has(uri)) {
        return false;
      }
      texts.set(uri, "");
      return true;
    },
    saveBytes: async (uri: string, data: Uint8Array) => {
      if (!texts.has(uri)) {
        throw new Error(`${uri} does not exist`);
      }
      texts.set(uri, new TextDecoder().decode(data));
    },
    save: async (uri: string, text: string) => {
      if (!texts.has(uri)) {
        throw Object.assign(new Error(`${uri} does not exist`), {
          code: "FileNotFound",
        });
      }
      texts.set(uri, text);
    },
  } as unknown as HostFiles;
  return { files, texts };
}

test("writeText makes a new file where save alone only replaces one", async () => {
  const { files, texts } = strictFiles();
  const workspace = createWorkspaceFiles(files, () => ["file:///vault"]);

  await workspace.writeText("file:///vault/Sketches/new.sketch.svg", "<svg/>");
  assert.equal(texts.get("file:///vault/Sketches/new.sketch.svg"), "<svg/>");

  await workspace.writeText(
    "file:///vault/Sketches/new.sketch.svg",
    "<svg>2</svg>",
  );
  assert.equal(
    texts.get("file:///vault/Sketches/new.sketch.svg"),
    "<svg>2</svg>",
  );

  await assert.rejects(workspace.writeText("file:///elsewhere/a.md", "x"));
  assert.equal(texts.has("file:///elsewhere/a.md"), false);
});

test("createText fills a new file and leaves an existing one as it is", async () => {
  const { files, texts } = strictFiles();
  const workspace = createWorkspaceFiles(files, () => ["file:///vault"]);

  assert.equal(
    await workspace.createText(
      "file:///vault/Journal/2026-11-05.md",
      "# Today",
    ),
    true,
  );
  assert.equal(texts.get("file:///vault/Journal/2026-11-05.md"), "# Today");

  assert.equal(
    await workspace.createText("file:///vault/Journal/2026-11-05.md", "other"),
    false,
  );
  assert.equal(texts.get("file:///vault/Journal/2026-11-05.md"), "# Today");

  await assert.rejects(workspace.createText("file:///elsewhere/a.md", "x"));
  assert.equal(texts.has("file:///elsewhere/a.md"), false);
});

test("createBytes fills a new file and leaves an existing one as it is", async () => {
  const { files, texts } = strictFiles();
  const workspace = createWorkspaceFiles(files, () => ["file:///vault"]);
  const image = "file:///vault/assets/image.png";
  const encode = (text: string) => new TextEncoder().encode(text);

  assert.equal(await workspace.createBytes(image, encode("first")), true);
  assert.equal(texts.get(image), "first");
  assert.equal(await workspace.createBytes(image, encode("second")), false);
  assert.equal(texts.get(image), "first");

  await assert.rejects(
    workspace.createBytes("file:///elsewhere/a.png", encode("x")),
  );
  assert.equal(texts.has("file:///elsewhere/a.png"), false);
});
