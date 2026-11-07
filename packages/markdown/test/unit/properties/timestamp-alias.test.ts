import test from "node:test";
import assert from "node:assert/strict";
import { frontmatter, propertyChanges } from "../../../src/markdown/properties";
import { clipboardProperties } from "../../../src/plugins/properties/clipboard-values";

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

const SOURCE =
  "---\ncreated: &d !!timestamp 2026-10-15 01:00:00 +08:00\nmirror: *d\n---\n";

test("replacing a timestamp that an alias shares keeps the alias at its wall-clock time", () => {
  const set = apply(SOURCE, {
    type: "set",
    key: "created",
    value: "2026-10-16T09:00",
  });
  assert.deepEqual(frontmatter(set)?.values, {
    created: "2026-10-16T09:00",
    mirror: "2026-10-15T01:00",
  });
});

test("a paste over a timestamp that an alias shares keeps the alias at its wall-clock time", () => {
  const merged = apply(SOURCE, {
    type: "merge",
    values: { created: "2026-10-16T09:00" },
  });
  assert.deepEqual(frontmatter(merged)?.values, {
    created: "2026-10-16T09:00",
    mirror: "2026-10-15T01:00",
  });
});

test("pasted YAML timestamps keep their wall-clock text", () => {
  assert.deepEqual(
    clipboardProperties(
      "created: !!timestamp 2026-10-15\nat: !!timestamp 2026-10-15 01:00:00 +08:00\n",
    ),
    { created: "2026-10-15", at: "2026-10-15T01:00" },
  );
});
