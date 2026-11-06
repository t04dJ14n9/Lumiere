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
    propertyDateText(offset, "2026-10-15 14:30:00 +08:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyDateText(
      new Date("2026-10-15T14:30:00.000Z"),
      "2026-10-15T14:30:00Z",
    ),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyDateText(
      new Date("2026-10-15T14:30:00.000Z"),
      "2026-10-15 14:30:00 Z",
    ),
    "2026-10-15T14:30",
  );
  // Without source, ISO/UTC remains the fallback.
  assert.equal(propertyDateText(offset), "2026-10-15T06:30");
});

test("obsidianDateTextFromYamlSource accepts space between date and time", () => {
  assert.equal(
    obsidianDateTextFromYamlSource("2026-10-15 14:30:00 +08:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    obsidianDateTextFromYamlSource("2026-10-15 14:30:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    obsidianDateTextFromYamlSource("2026-10-15 14:30:45"),
    "2026-10-15T14:30:45",
  );
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
    "---\nlocal: !!timestamp 2026-10-15T14:30:00+08:00\nspaced: !!timestamp 2026-10-15 14:30:00 +08:00\nutc: !!timestamp 2026-10-15T14:30:00Z\nmidnight: !!timestamp 2026-10-15T00:00:00\n---\n",
  );
  assert.equal(header?.values?.local, "2026-10-15T14:30");
  assert.equal(header?.values?.spaced, "2026-10-15T14:30");
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
    propertyYamlInput("!!timestamp 2026-10-15 14:30:00 +08:00"),
    "2026-10-15T14:30",
  );
  assert.equal(
    propertyYamlInput("!!timestamp 2026-10-15T14:30:00Z"),
    "2026-10-15T14:30",
  );
});

// YAML 1.1 timestamps the yaml library accepts beyond ±HH:MM: bare hour
// offsets and one-digit fields. They must keep the source's wall-clock digits
// instead of falling back to a UTC toISOString that can shift the day.
const YAML_TIMESTAMP_FORMS: readonly [source: string, expected: string][] = [
  ["2024-01-02 22:00:00 -5", "2024-01-02T22:00"],
  ["2024-01-02 22:00:00 +08", "2024-01-02T22:00"],
  ["2024-01-02 22:00:00 -05", "2024-01-02T22:00"],
  ["2024-01-02T22:00:00-5", "2024-01-02T22:00"],
  ["2024-01-02T22:00:00+5:30", "2024-01-02T22:00"],
  ["2024-01-02T22:00:00+05:30", "2024-01-02T22:00"],
  ["2024-01-02T22:00:00-0", "2024-01-02T22:00"],
  ["2024-01-02T22:00:00 Z", "2024-01-02T22:00"],
  ["2024-1-2", "2024-01-02"],
  ["2024-1-12", "2024-01-12"],
  ["2024-11-2", "2024-11-02"],
  ["2024-1-2 3:04:05", "2024-01-02T03:04:05"],
  ["2024-1-2 3:4:5", "2024-01-02T03:04:05"],
  ["2024-1-2t3:4:0 +8", "2024-01-02T03:04"],
  ["2024-01-02\t22:00:00\t-5", "2024-01-02T22:00"],
  ["2024-01-02  22:00:00.5 -5", "2024-01-02T22:00"],
  ["2024-01-02 22:00:30.250 -05:00", "2024-01-02T22:00:30"],
];

test("obsidianDateTextFromYamlSource reads every timestamp form yaml accepts", () => {
  for (const [source, expected] of YAML_TIMESTAMP_FORMS) {
    assert.equal(obsidianDateTextFromYamlSource(source), expected, source);
  }
});

test("obsidianDateTextFromYamlSource rejects text yaml does not read as a timestamp", () => {
  for (const source of [
    "24-01-02",
    "2024-001-02",
    "2024-01-02 22:00",
    "2024-01-02T22:00:00 +123",
    "2024-01-02T22:00:00 z",
    "2024-01-02T22:00:00 +08:0",
    "2024-01-02 22:00:00 UTC",
    "2024-01-02 junk",
    "",
  ]) {
    assert.equal(obsidianDateTextFromYamlSource(source), undefined, source);
  }
});

test("every form in the table is also one the yaml library reads as a Date", () => {
  const { parseDocument } = loadYaml();
  for (const [source] of YAML_TIMESTAMP_FORMS) {
    const document = parseDocument(`d: !!timestamp ${source}\n`);
    const node = document.get("d", true) as { value: unknown };
    assert.equal(document.errors.length, 0, source);
    assert.ok(node.value instanceof Date, source);
    assert.ok(Number.isFinite(node.value.valueOf()), source);
  }
});

test("propertyDateText keeps the source wall-clock for -5, +08, -05 and one-digit fields", () => {
  const { parseDocument } = loadYaml();
  for (const [source, expected] of YAML_TIMESTAMP_FORMS) {
    const document = parseDocument(`d: !!timestamp ${source}\n`);
    const node = document.get("d", true) as { value: Date; source?: string };
    assert.equal(propertyDateText(node.value, node.source), expected, source);
  }
});

test("a !!timestamp with a bare hour offset shows its source day, not the UTC day", () => {
  const header = frontmatter(
    "---\nd: !!timestamp 2024-01-02 22:00:00 -5\ne: !!timestamp 2024-01-02 01:00:00 +08\nf: !!timestamp 2024-1-2 3:4:5 -05\n---\n",
  );
  assert.equal(header?.values?.d, "2024-01-02T22:00");
  assert.equal(header?.values?.e, "2024-01-02T01:00");
  assert.equal(header?.values?.f, "2024-01-02T03:04:05");
  assert.equal(inferPropertyKind("d", header?.values?.d), "datetime");
  assert.equal(
    propertyYamlInput("!!timestamp 2024-01-02 22:00:00 -5"),
    "2024-01-02T22:00",
  );
  assert.equal(
    propertyYamlInput("!!timestamp 2024-01-02 01:00:00 +08"),
    "2024-01-02T01:00",
  );
  assert.equal(propertyYamlInput("!!timestamp 2024-1-2"), "2024-01-02");
});
