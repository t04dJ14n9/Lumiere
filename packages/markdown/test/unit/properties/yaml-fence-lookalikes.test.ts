import test from "node:test";
import assert from "node:assert/strict";
import { frontmatter, propertyChanges } from "../../../src/markdown/properties";

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

test("a property named like a document marker is written quoted", () => {
  for (const key of ["---foo", "...bar", "---", "..."]) {
    for (const source of ["Body\n", "---\na: 1\n---\nBody\n"]) {
      const next = apply(source, { type: "add", key, value: "x" });
      assert.deepEqual(
        frontmatter(next)?.values?.[key],
        "x",
        `${key} in ${source}`,
      );
    }
  }
});

test("a list item named like a document marker is written quoted", () => {
  for (const items of [["---foo"], ["a", "...b"], ["---"]]) {
    const next = apply("---\ntags:\n---\nBody\n", {
      type: "set",
      key: "tags",
      value: items,
    });
    assert.deepEqual(frontmatter(next)?.values?.tags, items);
  }
});

test("a value or a new name that opens like a document marker is written quoted", () => {
  const set = apply("---\ntitle: x # keep\n---\nBody\n", {
    type: "set",
    key: "title",
    value: "---foo",
  });
  assert.equal(set, '---\ntitle: "---foo" # keep\n---\nBody\n');
  const renamed = apply("---\ntitle: x\n---\nBody\n", {
    type: "rename",
    key: "title",
    name: "...bar",
  });
  assert.deepEqual(frontmatter(renamed)?.values, { "...bar": "x" });
});

test("removing the last property does not turn a body's --- block into the properties", () => {
  for (const eol of ["\n", "\r\n"]) {
    for (const bom of ["", "﻿"]) {
      for (const body of ["x: 2", "just text"]) {
        const source = [
          `${bom}---`,
          "a: 1",
          "---",
          "---",
          body,
          "---",
          "Body",
          "",
        ].join(eol);
        const next = apply(source, { type: "remove", keys: ["a"] });
        assert.equal(
          next,
          bom + eol + ["---", body, "---", "Body", ""].join(eol),
        );
        assert.equal(frontmatter(next), undefined);
      }
    }
  }
});

test("removing the last property of a note whose body is plain text leaves the text", () => {
  assert.equal(
    apply("---\na: 1\n---\nbody\n", { type: "remove", keys: ["a"] }),
    "body\n",
  );
});
