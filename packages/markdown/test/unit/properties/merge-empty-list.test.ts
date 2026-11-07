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

test("pasting an empty list adds the property as an empty one", () => {
  const next = apply("---\ndone: false\n---\nBody\n", {
    type: "merge",
    values: { tags: [], title: "x" },
  });
  assert.equal(next, "---\ndone: false\ntags:\ntitle: x\n---\nBody\n");
  assert.deepEqual(frontmatter(next)?.values, {
    done: false,
    tags: null,
    title: "x",
  });
});

test("pasting an empty list keeps the list a note already has", () => {
  const source = "---\ntags:\n  - a\n---\nBody\n";
  assert.equal(apply(source, { type: "merge", values: { tags: [] } }), source);
});
