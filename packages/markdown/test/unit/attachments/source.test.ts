import test from "node:test";
import assert from "node:assert/strict";
import {
  loadAttachmentOutcome,
  type SourceFetch,
} from "../../../src/attachments/source";

/** A fetch answering every URL with a body and, when given, a type. */
function serving(body: number[], type: string | null): SourceFetch {
  return async () => ({
    ok: true,
    headers: {
      get: (name) => (name === "content-type" ? type : null),
    },
    arrayBuffer: async () => new Uint8Array(body).buffer,
  });
}

const load = (url: string, fetch: SourceFetch) =>
  loadAttachmentOutcome(url, {
    imagesOnly: true,
    fetch,
    readFile: async () => undefined,
  });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const GIF = [...Buffer.from("GIF89a"), 1, 0];
const WEBP = [...Buffer.from("RIFF"), 4, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];
const AVIF = [0, 0, 0, 0x1c, ...Buffer.from("ftypavif")];
const SVG = [...Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"/>')];
const HTML = [...Buffer.from("<!doctype html><title>Sign in</title>")];

test("a response whose type is not an image is skipped, even at an image's name", async () => {
  for (const type of [
    "text/html; charset=utf-8",
    "application/json",
    "text/plain",
  ]) {
    assert.deepEqual(
      await load("https://ex.com/cat.png", serving(PNG, type)),
      { kind: "notImage" },
      type,
    );
  }
});

test("an image type is trusted and named by the URL, else by its type", async () => {
  const named = await load("https://ex.com/cat.PNG", serving([1], "image/png"));
  assert.equal(named.kind === "loaded" && named.source.ext, "png");
  const typed = await load(
    "https://ex.com/avatar?id=1",
    serving([1], "image/jpeg"),
  );
  assert.equal(typed.kind === "loaded" && typed.source.ext, "jpg");
});

test("a missing or generic type is decided by the bytes", async () => {
  const cases: [number[], string][] = [
    [PNG, "png"],
    [JPEG, "jpg"],
    [GIF, "gif"],
    [WEBP, "webp"],
    [AVIF, "avif"],
    [SVG, "svg"],
  ];
  for (const type of [
    null,
    "",
    "application/octet-stream",
    "binary/octet-stream",
  ]) {
    for (const [bytes, ext] of cases) {
      const outcome = await load("https://ex.com/raw", serving(bytes, type));
      assert.equal(
        outcome.kind === "loaded" && outcome.source.ext,
        ext,
        `${type} ${ext}`,
      );
    }
    assert.deepEqual(
      await load("https://ex.com/cat.png", serving(HTML, type)),
      { kind: "notImage" },
      `${type}: a page at an image's name`,
    );
  }
});

test("a URL's own image extension wins over the sniffed one", async () => {
  const outcome = await load("https://ex.com/a.jpeg", serving(PNG, null));
  assert.equal(outcome.kind === "loaded" && outcome.source.ext, "jpeg");
});

test("an unanswered or empty URL fails rather than being skipped", async () => {
  const refused: SourceFetch = async () => ({
    ok: false,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  assert.deepEqual(await load("https://ex.com/a.png", refused), {
    kind: "failed",
  });
  assert.deepEqual(
    await load("https://ex.com/a.png", serving([], "image/png")),
    { kind: "failed" },
  );
  assert.deepEqual(
    await load("https://ex.com/a.png", async () => {
      throw new Error("offline");
    }),
    { kind: "failed" },
  );
});
