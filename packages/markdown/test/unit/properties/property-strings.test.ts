import test from "node:test";
import assert from "node:assert/strict";
import { mapPropertyStrings } from "../../../src/markdown/properties";

function apply(
  source: string,
  replace: (value: string) => string | undefined,
): string {
  const changes = mapPropertyStrings(source, replace);
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    source =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
  }
  return source;
}

const link = (value: string) =>
  value.startsWith("http") ? `[[${value.split("/").pop()}]]` : undefined;

test("every top-level string, as a value or a list item, is offered in order", () => {
  const seen: string[] = [];
  const source = [
    "---",
    "cover: http://a/1.png",
    "title: 'Quoted'",
    "count: 3",
    "gallery:",
    "  - http://a/2.png",
    '  - "http://a/3.png"',
    "inline: [http://a/4.png, x]",
    "nested:",
    "  deep: http://a/5.png",
    "empty:",
    "---",
    "body http://a/6.png",
  ].join("\n");
  mapPropertyStrings(source, (value) => {
    seen.push(value);
    return undefined;
  });
  assert.deepEqual(seen, [
    "http://a/1.png",
    "Quoted",
    "http://a/2.png",
    "http://a/3.png",
    "http://a/4.png",
    "x",
  ]);
});

test("only the replaced values change, each in its own quoting and place", () => {
  const source = [
    "---",
    "# the cover",
    "cover:   http://a/cover.png   # keep",
    "alt: 'http://a/sing.png'",
    'dbl: "http://a/dbl.png"',
    "gallery:",
    "  - http://a/one.png # first",
    "  - other",
    "inline: [http://a/flow.png, x]",
    "---",
    "body",
  ].join("\n");
  assert.equal(
    apply(source, link),
    [
      "---",
      "# the cover",
      'cover:   "[[cover.png]]"   # keep',
      "alt: '[[sing.png]]'",
      'dbl: "[[dbl.png]]"',
      "gallery:",
      '  - "[[one.png]]" # first',
      "  - other",
      'inline: ["[[flow.png]]", x]',
      "---",
      "body",
    ].join("\n"),
  );
});

test("values YAML cannot rewrite in place are left alone", () => {
  const source = [
    "---",
    "block: |",
    "  http://a/block.png",
    "anchored: &u http://a/anchor.png",
    "alias: *u",
    "tagged: !!str http://a/tag.png",
    "---",
  ].join("\n");
  const seen: string[] = [];
  const changes = mapPropertyStrings(source, (value) => {
    seen.push(value);
    return "X";
  });
  assert.deepEqual(changes, []);
  assert.deepEqual(seen, []);
});

test("CRLF notes, a byte order mark and a missing or broken header are handled", () => {
  assert.equal(
    apply("﻿---\r\ncover: http://a/c.png\r\n---\r\nbody\r\n", link),
    '﻿---\r\ncover: "[[c.png]]"\r\n---\r\nbody\r\n',
  );
  assert.deepEqual(mapPropertyStrings("no header http://a/c.png", link), []);
  assert.deepEqual(mapPropertyStrings("---\na: [\n---\n", link), []);
  assert.deepEqual(mapPropertyStrings("---\n- a\n- b\n---\n", link), []);
});

test("a value that needs quoting is quoted, one with a quote is escaped", () => {
  const source = "---\ncover: http://a/c.png\nsingle: 'http://a/s.png'\n---\n";
  assert.equal(
    apply(source, (value) =>
      value.endsWith("c.png") ? "[[it's: a #1.png]]" : "[[it's.png]]",
    ),
    `---\ncover: "[[it's: a #1.png]]"\nsingle: '[[it''s.png]]'\n---\n`,
  );
});
