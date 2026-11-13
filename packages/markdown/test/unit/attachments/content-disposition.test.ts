import test from "node:test";
import assert from "node:assert/strict";
import { servedFileName } from "../../../src/attachments/content-disposition";

test("a quoted or bare filename is the served name", () => {
  assert.equal(servedFileName('attachment; filename="cat.png"'), "cat.png");
  assert.equal(servedFileName("inline; filename=cat.png"), "cat.png");
  assert.equal(
    servedFileName('attachment;FILENAME = "my cat.png" '),
    "my cat.png",
  );
  assert.equal(servedFileName('attachment; filename="a;b.png"'), "a;b.png");
  assert.equal(
    servedFileName('attachment; filename="say \\"hi\\".png"'),
    'say "hi".png',
  );
});

test("filename* is decoded and wins over filename", () => {
  assert.equal(
    servedFileName("attachment; filename*=UTF-8''na%C3%AFve%20cat.png"),
    "naïve cat.png",
  );
  assert.equal(
    servedFileName(
      `attachment; filename="naive.png"; filename*=utf-8'en'na%C3%AFve.png`,
    ),
    "naïve.png",
  );
  assert.equal(
    servedFileName("attachment; filename*=ISO-8859-1''na%EFve.png"),
    "naïve.png",
  );
});

test("a filename* that cannot be read falls back to filename", () => {
  for (const star of [
    "UTF-8''bad%ZZ.png",
    "UTF-8''bad%FF.png",
    "KOI8-R''x.png",
    "no-quotes.png",
  ]) {
    assert.equal(
      servedFileName(`attachment; filename*=${star}; filename="ok.png"`),
      "ok.png",
      star,
    );
  }
});

test("a name sent as raw UTF-8 bytes, which fetch reads as Latin-1, is repaired", () => {
  assert.equal(
    servedFileName('attachment; filename="na\u00c3\u00afve.png"'),
    "naïve.png",
  );
  assert.equal(
    servedFileName('attachment; filename="caf\u00e9.png"'),
    "café.png",
    "a Latin-1 name that is not UTF-8 is kept",
  );
});

test("only the base name is kept, without control characters", () => {
  assert.equal(
    servedFileName('attachment; filename="../../etc/passwd"'),
    "passwd",
  );
  assert.equal(
    servedFileName('attachment; filename="C:\\\\x\\\\c.png"'),
    "c.png",
  );
  assert.equal(
    servedFileName("attachment; filename*=UTF-8''..%2F..%2Fa.png"),
    "a.png",
  );
  assert.equal(
    servedFileName("attachment; filename*=UTF-8''a%00%0Ab%7F.png"),
    "ab.png",
  );
});

test("no usable name gives undefined", () => {
  for (const header of [
    null,
    "",
    "attachment",
    'attachment; name="x.png"',
    'attachment; filename=""',
    'attachment; filename=".."',
    'attachment; filename="dir/"',
    "attachment; filename*=UTF-8''%00",
  ]) {
    assert.equal(servedFileName(header), undefined, String(header));
  }
});
