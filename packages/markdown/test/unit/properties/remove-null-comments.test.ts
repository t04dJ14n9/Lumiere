import test from "node:test";
import assert from "node:assert/strict";
import { propertyChanges } from "../../../src/markdown/properties";

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

test("removing an empty property keeps the comment lines that follow it", () => {
  assert.equal(
    apply("---\na:\n# section comment for b\nb: 2\n---\nBody\n", {
      type: "remove",
      keys: ["a"],
    }),
    "---\n# section comment for b\nb: 2\n---\nBody\n",
  );
  assert.equal(
    apply("---\na: # todo\n# about b\n\n# more\nb: 2\n---\n", {
      type: "remove",
      keys: ["a"],
    }),
    "---\n# about b\n\n# more\nb: 2\n---\n",
  );
});

test("removing an empty last property keeps the comment after it", () => {
  assert.equal(
    apply("---\na: 1\nb:\n# trailing\n---\nBody\n", {
      type: "remove",
      keys: ["b"],
    }),
    "---\na: 1\n# trailing\n---\nBody\n",
  );
});

test("removing empty properties with an anchor, a tag or CRLF keeps the comments", () => {
  assert.equal(
    apply("---\r\na: &x\r\n# one\r\nb: !!null\r\n# two\r\nc: 3\r\n---\r\n", {
      type: "remove",
      keys: ["a", "b"],
    }),
    "---\r\n# one\r\n# two\r\nc: 3\r\n---\r\n",
  );
});
