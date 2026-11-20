import test from "node:test";
import assert from "node:assert/strict";
import { markdownFromHtml } from "../../../src/plugins/pasteHtml/conversion";
import { rewriteRemoteImages, decodeDataUri } from "../../../src/attachments";
import { DOWNLOAD_LIMITS } from "../../../src/attachments/guarded-download";
import { IMPORT_URL_TIMEOUT_MS } from "../../../src/plugins/attachments/protocol";
import {
  isAttachmentDrag,
  urisFromDataTransfer,
  shouldClaimEditorDrop,
  droppedAttachmentUris,
  droppedLinkText,
} from "../../../src/attachments/drop";

function transfer(partial: {
  types?: string[];
  files?: File[];
  getData?: (type: string) => string;
}): DataTransfer {
  const types = partial.types ?? [];
  const files = partial.files ?? [];
  return {
    types,
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    getData: partial.getData ?? (() => ""),
    setData() {},
    clearData() {},
    setDragImage() {},
    dropEffect: "none",
    effectAllowed: "all",
  } as DataTransfer;
}

test("isAttachmentDrag claims Files and uri-list payloads", () => {
  assert.equal(isAttachmentDrag(null), false);
  assert.equal(isAttachmentDrag(transfer({ types: ["text/plain"] })), false);
  assert.equal(isAttachmentDrag(transfer({ types: ["Files"] })), true);
  assert.equal(isAttachmentDrag(transfer({ types: ["text/uri-list"] })), true);
  assert.equal(
    isAttachmentDrag(transfer({ types: ["application/vnd.code.uri-list"] })),
    true,
  );
  assert.equal(
    isAttachmentDrag(
      transfer({
        types: [],
        files: [
          new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
        ],
      }),
    ),
    true,
  );
});

test("urisFromDataTransfer reads text/uri-list and code uri-list", () => {
  assert.deepEqual(
    urisFromDataTransfer(
      transfer({
        types: ["text/uri-list"],
        getData: (type) =>
          type === "text/uri-list"
            ? "file:///tmp/a.png\r\n#comment\r\nhttps://ex/b.png\n"
            : "",
      }),
    ),
    ["file:///tmp/a.png", "https://ex/b.png"],
  );
  assert.deepEqual(
    urisFromDataTransfer(
      transfer({
        types: ["application/vnd.code.uri-list"],
        getData: (type) =>
          type === "application/vnd.code.uri-list"
            ? JSON.stringify(["file:///vault/shot.png"])
            : "",
      }),
    ),
    ["file:///vault/shot.png"],
  );
});

test("a web link dragged from a browser is dropped as its text, not imported", () => {
  const drag = (uris: string, html = "", plain = uris) =>
    transfer({
      types: ["text/uri-list", "text/plain", "text/html"],
      getData: (type) =>
        ({ "text/uri-list": uris, "text/plain": plain, "text/html": html })[
          type
        ] ?? "",
    });
  const link = drag(
    "https://example.com/article?id=1",
    '<a href="https://example.com/article?id=1">An article</a>',
  );
  assert.deepEqual(droppedAttachmentUris(link), []);
  assert.equal(droppedLinkText(link), "https://example.com/article?id=1");
  // An image dragged from a page is imported, as is a link to an image file.
  const image = drag(
    "https://cdn.example.com/photo?w=800&h=600",
    '<img src="https://cdn.example.com/photo?w=800&amp;h=600" alt="">',
  );
  assert.deepEqual(droppedAttachmentUris(image), [
    "https://cdn.example.com/photo?w=800&h=600",
  ]);
  assert.deepEqual(droppedAttachmentUris(drag("https://ex.com/a/cat.PNG")), [
    "https://ex.com/a/cat.PNG",
  ]);
  // Files and VS Code resources are always attachments.
  assert.deepEqual(droppedAttachmentUris(drag("file:///tmp/notes.pdf")), [
    "file:///tmp/notes.pdf",
  ]);
  assert.equal(droppedLinkText(drag("file:///tmp/notes.pdf")), undefined);
});

test("shouldClaimEditorDrop is true for file drags so VS Code must not open tabs", () => {
  assert.equal(shouldClaimEditorDrop(transfer({ types: ["Files"] })), true);
  assert.equal(
    shouldClaimEditorDrop(transfer({ types: ["text/plain"] })),
    false,
  );
});

test("an image that cannot be imported keeps its link; the others are still rewritten", async () => {
  const markdown =
    "![a](https://ex.com/a.png) ![slow](https://slow.example/b.png) ![c](https://ex.com/c.png)";
  const out = await rewriteRemoteImages(markdown, async (src) => {
    if (src.includes("slow")) {
      throw new Error('RPC "importUrl" timed out');
    }
    return `![[${src.slice(-5)}]]`;
  });
  assert.equal(
    out,
    "![[a.png]] ![slow](https://slow.example/b.png) ![[c.png]]",
  );
});

test("a page waits for an image import as long as the host may download it", () => {
  assert.ok(IMPORT_URL_TIMEOUT_MS > DOWNLOAD_LIMITS.timeoutMs);
});

test("rich HTML data+http images rewrite to embeds after conversion", async () => {
  const md = markdownFromHtml(
    '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="green"><img src="https://example.com/remote.png" alt="remote"></p>',
  );
  assert.ok(md);
  assert.match(md!, /!\[green\]\(data:image\/png;base64,/);
  assert.match(md!, /!\[remote\]\(https:\/\/example\.com\/remote\.png\)/);

  const out = await rewriteRemoteImages(md!, async (src) => {
    if (src.startsWith("data:")) {
      const decoded = decodeDataUri(src);
      assert.ok(decoded);
      return "![[2026-10-30 15.00.png]]";
    }
    if (src.startsWith("https:")) {
      return "![[2026-10-30 15.01.png]]";
    }
    return undefined;
  });
  assert.equal(out.includes("![[2026-10-30 15.00.png]]"), true);
  assert.equal(out.includes("![[2026-10-30 15.01.png]]"), true);
  assert.equal(out.includes("data:image"), false);
  assert.equal(out.includes("https://example.com"), false);
});

import {
  isHostSourceUrl,
  loadAttachmentSource,
} from "../../../src/attachments/source";

test("isHostSourceUrl accepts http(s) and file, not data URIs", () => {
  assert.equal(isHostSourceUrl("https://ex/a.png"), true);
  assert.equal(isHostSourceUrl("http://ex/a.png"), true);
  assert.equal(isHostSourceUrl("file:///tmp/a.png"), true);
  assert.equal(isHostSourceUrl("data:image/png;base64,aaa"), false);
  assert.equal(isHostSourceUrl("javascript:alert(1)"), false);
});

test("loadAttachmentSource downloads http and reads file URIs", async () => {
  const http = await loadAttachmentSource("https://ex/a.png", {
    fetch: async () => ({
      ok: true,
      headers: {
        get: (name) => (name === "content-type" ? "image/png" : null),
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
    readFile: async () => undefined,
  });
  assert.ok(http);
  assert.equal(http!.ext, "png");
  assert.deepEqual([...http!.bytes], [1, 2, 3]);

  const file = await loadAttachmentSource("file:///vault/shot.jpg", {
    fetch: async () => {
      throw new Error("no network for file");
    },
    readFile: async () => new Uint8Array([9, 8]),
  });
  assert.ok(file);
  assert.equal(file!.ext, "jpg");
  assert.deepEqual([...file!.bytes], [9, 8]);

  const fail = await loadAttachmentSource("https://ex/missing.png", {
    fetch: async () => ({
      ok: false,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    readFile: async () => undefined,
  });
  assert.equal(fail, undefined);
});

test("a URL from the page loads only images, never any file on the disk", async () => {
  const read: string[] = [];
  const fetched: string[] = [];
  const served = (type: string) => async (url: string) => {
    fetched.push(url);
    return {
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? type : null),
      },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    };
  };
  const options = (type: string) => ({
    imagesOnly: true,
    fetch: served(type),
    readFile: async (uri: string) => {
      read.push(uri);
      return new Uint8Array([7]);
    },
  });
  for (const url of [
    "file:///Users/me/.ssh/id_rsa",
    "file:///Users/me/project/.env",
    "file:///Users/me/notes/secrets.json",
  ]) {
    assert.equal(
      await loadAttachmentSource(url, options("text/plain")),
      undefined,
      url,
    );
  }
  assert.deepEqual(read, [], "nothing but an image is read");
  assert.equal(
    (await loadAttachmentSource("file:///tmp/clip.PNG", options("")))?.ext,
    "png",
  );
  assert.equal(
    await loadAttachmentSource(
      "http://127.0.0.1:8080/admin",
      options("application/json"),
    ),
    undefined,
  );
  assert.equal(
    (
      await loadAttachmentSource(
        "https://ex/avatar.php?id=1",
        options("image/jpeg"),
      )
    )?.ext,
    "jpg",
    "an image is kept under its type's extension",
  );
  assert.equal(
    await loadAttachmentSource("https://ex/a.webp", options("")),
    undefined,
    "without a type, bytes that are no image are not kept at an image's name",
  );
});

test("urisFromDataTransfer reads VS Code ResourceURLs JSON", () => {
  assert.deepEqual(
    urisFromDataTransfer(
      transfer({
        types: ["ResourceURLs"],
        getData: (type) =>
          type === "ResourceURLs"
            ? JSON.stringify(["file:///vault/pic.png"])
            : "",
      }),
    ),
    ["file:///vault/pic.png"],
  );
  assert.equal(isAttachmentDrag(transfer({ types: ["ResourceURLs"] })), true);
});
