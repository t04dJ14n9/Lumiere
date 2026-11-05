import test from "node:test";
import assert from "node:assert/strict";
import { frontmatter } from "../../../src/markdown/properties";
import { loadYaml } from "../../../src/markdown/properties/load-yaml";
import { inferPropertyKind } from "../../../src/markdown/properties/types";
import {
  matchesPropertyKind,
  obsidianDateTextFromYamlSource,
  propertyDateText,
  propertyInput,
  propertyYamlInput,
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

test("propertyDateText keeps wall-clock from YAML source for offsets and Z", () => {
  const offset = new Date("2026-10-15T06:30:00.000Z");
  assert.equal(
    propertyDateText(offset, "2026-10-15T14:30:00+08:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyDateText(
      new Date("2026-10-15T14:30:00.000Z"),
      "2026-10-15T14:30:00Z",
    ),
    "2026-10-15T14:30",
  );
  // Without source, ISO/UTC remains the fallback.
  assert.equal(propertyDateText(offset), "2026-10-15T06:30");
});

test("obsidianDateTextFromYamlSource treats T00:00:00 as datetime, not date", () => {
  assert.equal(obsidianDateTextFromYamlSource("2026-10-15"), "2026-10-15");
  assert.equal(
    obsidianDateTextFromYamlSource("2026-10-15T00:00:00"),
    "2026-10-15T00:00",
  );
  assert.equal(
    obsidianDateTextFromYamlSource("2026-10-15T00:00:00Z"),
    "2026-10-15T00:00",
  );
});

test("frontmatter preserves !!timestamp wall-clock for +08:00 and Z", () => {
  const header = frontmatter(
    "---\nlocal: !!timestamp 2026-10-15T14:30:00+08:00\nutc: !!timestamp 2026-10-15T14:30:00Z\nmidnight: !!timestamp 2026-10-15T00:00:00\n---\n",
  );
  assert.equal(header?.values?.local, "2026-10-15T14:30");
  assert.equal(header?.values?.utc, "2026-10-15T14:30");
  assert.equal(header?.values?.midnight, "2026-10-15T00:00");
  assert.equal(inferPropertyKind("local", header?.values?.local), "datetime");
  assert.equal(
    inferPropertyKind("midnight", header?.values?.midnight),
    "datetime",
  );
});

test("YAML drafts keep +08:00 and Z wall-clock as plain datetime strings", () => {
  assert.equal(
    propertyYamlInput("!!timestamp 2026-10-15T14:30:00+08:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyYamlInput("!!timestamp 2026-10-15T14:30:00Z"),
    "2026-10-15T14:30",
  );
});
