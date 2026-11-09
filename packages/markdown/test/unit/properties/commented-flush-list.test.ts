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

test("setting a list written flush under a commented key keeps the comment", () => {
  assert.equal(
    apply("---\ntags: # keep\n- a\n---\nBody\n", {
      type: "set",
      key: "tags",
      value: ["a", "b"],
    }),
    "---\ntags: # keep\n  - a\n  - b\n---\nBody\n",
  );
});

test("comment lines between the key and a flush list stay, and the next property is untouched", () => {
  const next = apply("---\ntags: # one\n# two\n- a\n- b\nnext: 1\n---\n", {
    type: "set",
    key: "tags",
    value: ["c"],
  });
  assert.equal(next, "---\ntags: # one\n# two\n  - c\nnext: 1\n---\n");
  assert.deepEqual(frontmatter(next)?.values, { tags: ["c"], next: 1 });
});

test("clearing a flush list under a commented key keeps the comment and leaves no blank line", () => {
  assert.equal(
    apply("---\ntags: # keep\n- a\nnext: 1\n---\n", {
      type: "set",
      key: "tags",
      value: [],
    }),
    "---\ntags: # keep\nnext: 1\n---\n",
  );
});

test("a flush list under a commented key keeps CRLF line ends", () => {
  assert.equal(
    apply("---\r\ntags: # keep\r\n- a\r\n---\r\n", {
      type: "set",
      key: "tags",
      value: ["a", "b"],
    }),
    "---\r\ntags: # keep\r\n  - a\r\n  - b\r\n---\r\n",
  );
});

test("a commented key with an apostrophe or a double quote in its name still edits its list", () => {
  for (const key of ["owner's list", "don't", 'say "hi"']) {
    assert.equal(
      apply(`---\n${key}: # keep\n- a\nnext: 1\n---\nBody\n`, {
        type: "set",
        key,
        value: ["a", "b"],
      }),
      `---\n${key}: # keep\n  - a\n  - b\nnext: 1\n---\nBody\n`,
    );
    assert.equal(
      apply(`---\n${key}: # keep\n  - a\n---\nBody\n`, {
        type: "set",
        key,
        value: ["a", "b"],
      }),
      `---\n${key}: # keep\n  - a\n  - b\n---\nBody\n`,
    );
  }
});

test("a quoted key that holds a colon and a hash still edits its commented list", () => {
  assert.equal(
    apply('---\n"a: #b": # keep\n- a\n---\nBody\n', {
      type: "set",
      key: "a: #b",
      value: ["a", "b"],
    }),
    '---\n"a: #b": # keep\n  - a\n  - b\n---\nBody\n',
  );
});

test("a list item with a line break is written as a quoted string", () => {
  assert.equal(
    apply("---\ncustom: # keep\n  - a\nnext: 1\n---\nBody\n", {
      type: "set",
      key: "custom",
      value: ["a", "one\ntwo"],
    }),
    '---\ncustom: # keep\n  - a\n  - "one\\ntwo"\nnext: 1\n---\nBody\n',
  );
  assert.equal(
    apply("---\ncustom:\n  - a\n---\nBody\n", {
      type: "set",
      key: "custom",
      value: ["a", "one\ntwo"],
    }),
    '---\ncustom:\n  - a\n  - "one\\ntwo"\n---\nBody\n',
  );
  assert.equal(
    apply("---\ncustom: [a]\n---\nBody\n", {
      type: "set",
      key: "custom",
      value: ["a", "one\r\ntwo"],
    }),
    '---\ncustom:\n  - a\n  - "one\\r\\ntwo"\n---\nBody\n',
  );
});

test("a list that already holds a line break in an item keeps being editable", () => {
  const next = apply('---\ncustom:\n  - "a\\nb"\n---\nBody\n', {
    type: "set",
    key: "custom",
    value: ["a\nb", "c"],
  });
  assert.equal(next, '---\ncustom:\n  - "a\\nb"\n  - c\n---\nBody\n');
  assert.deepEqual(frontmatter(next)?.values, { custom: ["a\nb", "c"] });
});

test("pasting a list with a line break in an item merges it", () => {
  assert.equal(
    apply("---\ncustom:\n  - a\n---\nBody\n", {
      type: "merge",
      values: { custom: ["one\ntwo"] },
    }),
    '---\ncustom:\n  - a\n  - "one\\ntwo"\n---\nBody\n',
  );
});
