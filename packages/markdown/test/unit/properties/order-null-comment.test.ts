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

test("reordering an empty property moves the comment above the next key with it", () => {
  const source = "---\na:\n# comment before b\nb: 2\n---\nBody\n";
  const next = apply(source, { type: "order", keys: ["b", "a"] });
  assert.equal(next, "---\n# comment before b\nb: 2\na:\n---\nBody\n");
  assert.deepEqual(frontmatter(next)?.values, { b: 2, a: null });
});

test("reordering empty properties keeps comment lines, blank lines and CRLF", () => {
  const source =
    "---\r\na: # t\r\n# one\r\n\r\n# two\r\nb: 2\r\nc:\r\n  # three\r\n---\r\nBody\r\n";
  assert.equal(
    apply(source, { type: "order", keys: ["b", "c", "a"] }),
    "---\r\n# one\r\n\r\n# two\r\nb: 2\r\nc:\r\n  # three\r\na: # t\r\n---\r\nBody\r\n",
  );
  assert.equal(
    apply(source, { type: "order", keys: ["c", "a", "b"] }),
    "---\r\nc:\r\n  # three\r\na: # t\r\n# one\r\n\r\n# two\r\nb: 2\r\n---\r\nBody\r\n",
  );
});
