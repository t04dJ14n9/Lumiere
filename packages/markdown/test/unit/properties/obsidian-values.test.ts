import test from "node:test";
import assert from "node:assert/strict";
import { frontmatter } from "../../../src/markdown/properties";
import { loadYaml } from "../../../src/markdown/properties/load-yaml";
import { inferPropertyKind } from "../../../src/markdown/properties/types";
import {
  matchesPropertyKind,
  propertyDateText,
  propertyInput,
  settablePropertyNode,
  settablePropertyValue,
} from "../../../src/markdown/properties/values";

// Measured in a throwaway Obsidian vault (2026-10-17).
test("a text property loses trailing spaces and keeps leading ones, as in Obsidian", () => {
  assert.equal(propertyInput("text", "trailing "), "trailing");
  assert.equal(propertyInput("text", "  lead"), "  lead");
  assert.equal(propertyInput("text", "mid  dle"), "mid  dle");
});

test("YAML !!timestamp scalars are settable Date values", () => {
  const { parseDocument } = loadYaml();
  for (const yaml of [
    "!!timestamp 2026-10-15",
    "!!timestamp 2026-10-15T14:30:00",
  ]) {
    const document = parseDocument(`created: ${yaml}\n`);
    const node = document.get("created", true);
    const value = document.toJS().created;
    assert.ok(value instanceof Date);
    assert.equal(settablePropertyNode(node, document), true);
    assert.equal(settablePropertyValue(value), true);
  }
});

test("frontmatter editableKeys include !!timestamp date scalars", () => {
  const header = frontmatter(
    "---\ncreated: !!timestamp 2026-10-15\nupdated: !!timestamp 2026-10-15T14:30:00\n---\n",
  );
  assert.deepEqual(header?.editableKeys?.slice().sort(), [
    "created",
    "updated",
  ]);
});

test("inferPropertyKind treats Date midnight as date and timed Date as datetime", () => {
  assert.equal(
    inferPropertyKind("created", new Date("2026-10-15T00:00:00.000Z")),
    "date",
  );
  assert.equal(
    inferPropertyKind("updated", new Date("2026-10-15T14:30:00.000Z")),
    "datetime",
  );
});

test("propertyDateText formats Obsidian-stable date and datetime strings", () => {
  assert.equal(
    propertyDateText(new Date("2026-10-15T00:00:00.000Z")),
    "2026-10-15",
  );
  assert.equal(
    propertyDateText(new Date("2026-10-15T14:30:00.000Z")),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyDateText(new Date("2026-10-15T14:30:45.000Z")),
    "2026-10-15T14:30:45",
  );
});

test("matchesPropertyKind accepts Date for date and datetime kinds", () => {
  assert.equal(
    matchesPropertyKind("date", new Date("2026-10-15T00:00:00.000Z")),
    true,
  );
  assert.equal(
    matchesPropertyKind("datetime", new Date("2026-10-15T14:30:00.000Z")),
    true,
  );
  assert.equal(
    matchesPropertyKind("date", new Date("2026-10-15T14:30:00.000Z")),
    false,
  );
});
