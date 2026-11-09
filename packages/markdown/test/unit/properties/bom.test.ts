import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { markdownParser } from "../../../src/markdown/dialect";
import { frontmatter, propertyChanges } from "../../../src/markdown/properties";
import { frontmatterBodyStart } from "../../../src/plugins/properties/caret-guard";

const BOM = "﻿";

function apply(
  source: string,
  operation: Parameters<typeof propertyChanges>[1],
): string {
  const changes = propertyChanges(source, operation);
  assert.ok(changes, `Rejected ${operation.type}`);
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    source =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
  }
  return source;
}

test("a byte order mark before the opening fence is not part of the properties", () => {
  const source = `${BOM}---\ntitle: Hello\n---\nBody\n`;
  const header = frontmatter(source);
  assert.deepEqual(header?.values, { title: "Hello" });
  assert.equal(header?.raw, `${BOM}---\ntitle: Hello\n---\n`);
  assert.equal(source.slice(header?.end), "Body\n");
});

test("adding a property to a note with a byte order mark extends its header", () => {
  assert.equal(
    apply(`${BOM}---\ntitle: Hello\n---\nBody\n`, {
      type: "add",
      key: "status",
      value: "ok",
    }),
    `${BOM}---\ntitle: Hello\nstatus: ok\n---\nBody\n`,
  );
});

test("a header made for a note with a byte order mark follows the mark", () => {
  assert.equal(
    apply(`${BOM}Body\n`, { type: "add", key: "status", value: "ok" }),
    `${BOM}---\nstatus: ok\n---\nBody\n`,
  );
});

test("a note with a byte order mark and a broken fence gets no second header", () => {
  assert.equal(
    propertyChanges(`${BOM}---\ntitle: Hello\nBody\n`, {
      type: "add",
      key: "status",
      value: "ok",
    }),
    undefined,
  );
});

test("editing other properties of a note with a byte order mark keeps the mark", () => {
  const source = `${BOM}---\r\na: 1\r\nb: 2\r\n---\r\nBody\r\n`;
  assert.equal(
    apply(source, { type: "set", key: "a", value: 3 }),
    `${BOM}---\r\na: 3\r\nb: 2\r\n---\r\nBody\r\n`,
  );
  assert.equal(
    apply(source, { type: "order", keys: ["b", "a"] }),
    `${BOM}---\r\nb: 2\r\na: 1\r\n---\r\nBody\r\n`,
  );
  assert.equal(
    apply(source, { type: "remove", keys: ["a"] }),
    `${BOM}---\r\nb: 2\r\n---\r\nBody\r\n`,
  );
});

test("removing the last property of a note with a byte order mark keeps the mark", () => {
  assert.equal(
    apply(`${BOM}---\na: 1\n---\nBody\n`, { type: "remove", keys: ["a"] }),
    `${BOM}Body\n`,
  );
  assert.equal(
    apply(`${BOM}---\r\na: 1\r\n---\r\nBody\r\n`, {
      type: "remove",
      keys: ["a"],
    }),
    `${BOM}Body\r\n`,
  );
});

test("the Markdown dialect and the caret guard see a header behind a byte order mark", () => {
  const source = `${BOM}---\ntitle: Hello\n---\nBody\n`;
  const nodes: string[] = [];
  markdownParser.parse(source).iterate({
    enter(node) {
      if (node.name === "Frontmatter") {
        nodes.push(`${node.from}-${node.to}`);
      }
    },
  });
  assert.deepEqual(nodes, [`0-${source.indexOf("\n---\n") + 4}`]);
  assert.equal(
    frontmatterBodyStart(Text.of(source.split("\n"))),
    source.indexOf("Body"),
  );
});
