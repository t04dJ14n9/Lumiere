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

test("removing a property keeps the fence while a numeric or boolean key remains", () => {
  assert.equal(
    apply("---\n1: keep\ntitle: drop\n---\nBody\n", {
      type: "remove",
      keys: ["title"],
    }),
    "---\n1: keep\n---\nBody\n",
  );
  assert.equal(
    apply("---\ntrue: keep\ntitle: drop\n---\nBody\n", {
      type: "remove",
      keys: ["title"],
    }),
    "---\ntrue: keep\n---\nBody\n",
  );
});

test("a numeric or boolean key can be removed like any other", () => {
  assert.equal(
    apply("---\n1: drop\ntitle: keep\n---\nBody\n", {
      type: "remove",
      keys: ["1"],
    }),
    "---\ntitle: keep\n---\nBody\n",
  );
  assert.equal(
    apply("---\ntrue: drop\ntitle: keep\n---\nBody\n", {
      type: "remove",
      keys: ["true"],
    }),
    "---\ntitle: keep\n---\nBody\n",
  );
});

test("removing every key, numeric ones included, drops the empty fence", () => {
  assert.equal(
    apply("---\n1: a\ntitle: b\n---\nBody\n", {
      type: "remove",
      keys: ["1", "title"],
    }),
    "Body\n",
  );
});

test("a numeric key in a flow mapping is removed too", () => {
  assert.equal(
    apply("---\n{1: a, title: b}\n---\nBody\n", {
      type: "remove",
      keys: ["1"],
    }),
    "---\n{ title: b }\n---\nBody\n",
  );
  assert.equal(
    apply("---\n{1: a, title: b}\n---\nBody\n", {
      type: "remove",
      keys: ["title"],
    }),
    "---\n{ 1: a }\n---\nBody\n",
  );
});
