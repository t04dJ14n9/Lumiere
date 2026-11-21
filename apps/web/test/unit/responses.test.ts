// The worker answers a file a note shows whole, or the one byte range a
// video asks for, with its media type.
import test from "node:test";
import assert from "node:assert/strict";
import { byteRange, vaultFileResponse } from "../../src/worker/responses";

const VIDEO = new Blob([Uint8Array.from({ length: 100 }, (_, i) => i)]);
const CLIP = "file:///vaults/Notes/Attachments/clip.mp4";

async function bytes(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer())];
}

test("one byte range: both ends, from a point to the end, or the last bytes", () => {
  assert.deepEqual(byteRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(byteRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-500", 100), { start: 0, end: 99 });
});

test("a range past the end, or backwards, cannot be met", () => {
  assert.equal(byteRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(byteRange("bytes=50-10", 100), "unsatisfiable");
  assert.equal(byteRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(byteRange("bytes=0-", 0), "unsatisfiable");
});

test("no range, several, or one that does not parse means the whole file", () => {
  assert.equal(byteRange(null, 100), undefined);
  assert.equal(byteRange("bytes=0-1, 5-9", 100), undefined);
  assert.equal(byteRange("bytes=-", 100), undefined);
  assert.equal(byteRange("items=0-1", 100), undefined);
});

test("a whole file is 200, with its type, length and byte ranges offered", async () => {
  const response = vaultFileResponse(
    { kind: "file", file: VIDEO },
    { uri: CLIP, range: null },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await bytes(response)).length, 100);
});

test("a range is 206 with those bytes; one past the end is 416", async () => {
  const part = vaultFileResponse(
    { kind: "file", file: VIDEO },
    { uri: CLIP, range: "bytes=10-12" },
  );
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 10-12/100");
  assert.equal(part.headers.get("content-length"), "3");
  assert.deepEqual(await bytes(part), [10, 11, 12]);
  const past = vaultFileResponse(
    { kind: "file", file: VIDEO },
    { uri: CLIP, range: "bytes=200-" },
  );
  assert.equal(past.status, 416);
  assert.equal(past.headers.get("content-range"), "bytes */100");
});

test("a vault's file never runs as a page on the app's origin", () => {
  const response = (name: string) =>
    vaultFileResponse(
      { kind: "file", file: new Blob(["<script>alert(1)</script>"]) },
      { uri: `file:///vaults/Notes/${name}`, range: null },
    ).headers;
  // As an image it runs nothing; opened as a page it is sandboxed.
  const svg = response("diagram.SVG");
  assert.equal(svg.get("content-type"), "image/svg+xml");
  assert.equal(
    svg.get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  assert.equal(
    response("photo.png").get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  for (const name of ["page.html", "tool.js", "feed.xml"]) {
    const headers = response(name);
    assert.equal(headers.get("content-type"), "application/octet-stream");
    assert.equal(headers.get("content-disposition"), "attachment");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
  }
  // Chrome would refuse to show a sandboxed PDF.
  assert.equal(response("paper.pdf").get("content-security-policy"), null);
});

test("a refused file is 403; a missing one, or no answer, 404", () => {
  const request = { uri: CLIP, range: null };
  assert.equal(vaultFileResponse({ kind: "refused" }, request).status, 403);
  assert.equal(vaultFileResponse({ kind: "missing" }, request).status, 404);
  assert.equal(vaultFileResponse({ kind: "unknown" }, request).status, 404);
  assert.equal(vaultFileResponse(undefined, request).status, 404);
});

test("media types by extension, from the file URI; anything else is bytes", () => {
  const type = (uri: string) =>
    vaultFileResponse(
      { kind: "file", file: new Blob([]) },
      { uri, range: null },
    ).headers.get("content-type");
  assert.equal(type("file:///v/a%20b.JPG"), "image/jpeg");
  assert.equal(type("file:///v/motion.webm"), "video/webm");
  assert.equal(type("file:///v/paper.pdf"), "application/pdf");
  assert.equal(type("file:///v/song.m4a"), "audio/mp4");
  assert.equal(type("file:///v/page.html"), "application/octet-stream");
  assert.equal(type("file:///v/Makefile"), "application/octet-stream");
  assert.equal(type("file:///v.d/README"), "application/octet-stream");
});
