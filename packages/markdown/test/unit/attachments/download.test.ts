import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadStem,
  embedFor,
  remoteImages,
  uniqueName,
  withDownloadedImages,
} from "../../../src/attachments";

// Obsidian 1.15.0's Download attachments for current file, read from its
// app.js with REA (2026-11-07).

test("the images to download are web and data-URI Markdown images, not code or vault files", () => {
  const text = [
    '![a b](https://ex.com/p%20q.png) ![](<https://ex.com/r.jpg> "t")',
    "```",
    "![c](https://in.code/x.png)",
    "```",
    "![d](data:image/png;base64,AAAA) ![[local.png]] [link](https://web)\r",
    "![e](./rel.png) ![f](HTTP://EX.COM/S.GIF)",
  ].join("\n");
  assert.deepEqual(
    remoteImages(text).map(({ url, alt }) => [url, alt]),
    [
      ["https://ex.com/p%20q.png", "a b"],
      ["https://ex.com/r.jpg", ""],
      ["data:image/png;base64,AAAA", "d"],
      ["HTTP://EX.COM/S.GIF", "f"],
    ],
  );
  const [first] = remoteImages(text);
  assert.equal(
    text.slice(first!.from, first!.to),
    "![a b](https://ex.com/p%20q.png)",
  );
});

test("a downloaded image keeps its URL's file name, or is called Image", () => {
  assert.equal(downloadStem("https://ex.com/a/photo.png?w=2"), "photo");
  assert.equal(downloadStem("https://ex.com/my%20cat.jpeg"), "my cat");
  assert.equal(downloadStem("https://ex.com/avatar?id=1"), "Image");
  assert.equal(downloadStem("https://ex.com/"), "Image");
  assert.equal(downloadStem("https://ex.com/file.we-bp"), "Image");
  assert.equal(downloadStem("data:image/png;base64,AAAA"), "Image");
  assert.equal(
    downloadStem("https://ex.com/a%3Ab%23c%5Bd%5D.png"),
    "a b c[d]",
    "characters that break links or names become spaces",
  );
  assert.equal(downloadStem("https://ex.com/%5B%5Bx%5D%5D.png"), "x");
});

test("a taken name gets a number, compared without case", () => {
  assert.equal(uniqueName("photo", "png", []), "photo.png");
  assert.equal(uniqueName("photo", "png", ["Photo.PNG"]), "photo 1.png");
  assert.equal(
    uniqueName("photo", "png", ["photo.png", "photo 1.png"]),
    "photo 2.png",
  );
});

test("the embed keeps the image's alt text", () => {
  const link = {
    path: "assets/photo.png",
    notePath: "Note.md",
    format: "shortest" as const,
    isNameUnique: true,
  };
  assert.equal(
    embedFor({ ...link, useWikilinks: true, alt: "A cat" }),
    "![[photo.png|A cat]]",
  );
  assert.equal(
    embedFor({ ...link, useWikilinks: true, alt: "" }),
    "![[photo.png]]",
  );
  assert.equal(
    embedFor({ ...link, useWikilinks: true, alt: "PHOTO.png" }),
    "![[photo.png]]",
  );
  assert.equal(
    embedFor({ ...link, useWikilinks: false, alt: "A [big] | cat" }),
    "![A big cat](photo.png)",
    "brackets and pipes would end the link",
  );
});

test("images are replaced where they are now, after edits made while downloading", () => {
  const before = "![x](https://ex.com/a.png)";
  const now = `New line\n${before} and ![y](https://ex.com/b.png)`;
  const edits = withDownloadedImages(now, (url, alt) =>
    url.endsWith("a.png") ? `![[a.png|${alt}]]` : undefined,
  );
  assert.deepEqual(edits, [
    { from: 9, to: 9 + before.length, insert: "![[a.png|x]]" },
  ]);
});
