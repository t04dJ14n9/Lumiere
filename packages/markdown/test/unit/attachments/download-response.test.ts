import test from "node:test";
import assert from "node:assert/strict";
import {
  contentDispositionFilename,
  isImageResponse,
} from "../../../src/plugins/attachments/download-response";

// Pure facts read from a fetched response for Download Attachments. The
// behaviour to match is Obsidian 1.15.0's (app.js, REA, 2026-11-07); this is
// the first step of issue #695, so the helpers are not wired in yet.

test("a plain Content-Disposition filename is read, quoted or bare", () => {
  assert.equal(
    contentDispositionFilename('attachment; filename="cat.png"'),
    "cat.png",
  );
  assert.equal(
    contentDispositionFilename("attachment; filename=cat.png"),
    "cat.png",
  );
  assert.equal(
    contentDispositionFilename("inline; filename=report.pdf"),
    "report.pdf",
  );
});

test("an RFC 5987 filename* wins over a plain filename", () => {
  assert.equal(
    contentDispositionFilename(
      "attachment; filename=fallback.pdf; filename*=UTF-8''%E2%82%AC%20rates.pdf",
    ),
    "€ rates.pdf",
  );
  assert.equal(
    contentDispositionFilename(
      "attachment; filename*=UTF-8''na%C3%AFve.jpg; filename=fallback.jpg",
    ),
    "naïve.jpg",
  );
});

test("parameter names and the UTF-8 label are case-insensitive", () => {
  assert.equal(
    contentDispositionFilename(
      "ATTACHMENT; FILENAME*=utf-8''Photo%20One.PNG; FILENAME=x.png",
    ),
    "Photo One.PNG",
  );
});

test("a semicolon or an escaped quote inside a quoted filename stays", () => {
  assert.equal(
    contentDispositionFilename('attachment; filename="a;b.png"'),
    "a;b.png",
  );
  assert.equal(
    contentDispositionFilename('attachment; filename="a\\"b.png"'),
    'a"b.png',
  );
});

test("only the last path segment of a suggested name is kept", () => {
  assert.equal(
    contentDispositionFilename('attachment; filename="../../etc/passwd.png"'),
    "passwd.png",
  );
  // RFC 6266 quoted-pairs: the sender doubles each backslash of a Windows path.
  assert.equal(
    contentDispositionFilename(
      String.raw`attachment; filename="C:\\dir\\pic.png"`,
    ),
    "pic.png",
  );
  assert.equal(
    contentDispositionFilename('attachment; filename="  spaced.png  "'),
    "spaced.png",
  );
});

test("a broken or non-UTF-8 filename* falls back to the plain filename", () => {
  assert.equal(
    contentDispositionFilename(
      "attachment; filename*=iso-8859-1''caf%E9.png; filename=fallback.png",
    ),
    "fallback.png",
  );
  assert.equal(
    contentDispositionFilename(
      "attachment; filename*=UTF-8''bad%E0%A4%A; filename=fallback.png",
    ),
    "fallback.png",
  );
  assert.equal(
    contentDispositionFilename(
      "attachment; filename*=not-a-value; filename=fallback.png",
    ),
    "fallback.png",
  );
});

test("no filename, no header, or an empty filename gives undefined", () => {
  assert.equal(contentDispositionFilename(undefined), undefined);
  assert.equal(contentDispositionFilename(null), undefined);
  assert.equal(contentDispositionFilename(""), undefined);
  assert.equal(contentDispositionFilename("attachment"), undefined);
  assert.equal(
    contentDispositionFilename('attachment; filename=""'),
    undefined,
  );
});

test("a response served as an image is an image, whatever its URL", () => {
  assert.equal(
    isImageResponse("https://ex.com/a/photo.png", "image/png"),
    true,
  );
  assert.equal(
    isImageResponse(
      "https://ex.com/avatar.php",
      "IMAGE/SVG+XML; charset=utf-8",
    ),
    true,
  );
  assert.equal(isImageResponse("https://ex.com/page", "image/jpeg"), true);
});

test("a URL that looks like an image but serves no image is not one", () => {
  assert.equal(
    isImageResponse("https://ex.com/a/photo.png", "text/html"),
    false,
  );
  assert.equal(
    isImageResponse("https://ex.com/a/photo.png", "text/html; charset=utf-8"),
    false,
  );
  assert.equal(
    isImageResponse("https://ex.com/a/photo.png", "application/octet-stream"),
    false,
  );
});

test("with no Content-Type the URL's extension decides", () => {
  assert.equal(
    isImageResponse("https://ex.com/a/photo.JPG?w=2", undefined),
    true,
  );
  assert.equal(isImageResponse("https://ex.com/a/photo.webp", "  "), true);
  assert.equal(isImageResponse("https://ex.com/page", null), false);
  assert.equal(isImageResponse("not a url", null), false);
});
