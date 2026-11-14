import assert from "node:assert/strict";
import test from "node:test";
import { frontmatter } from "../../../src/markdown/properties";
import { scratchFileName } from "../../../src/plugins/scratch/names";
import { scratchNote } from "../../../src/plugins/scratch/template";

test("a scratch note has a title and capture time, and no type", () => {
  const text = scratchNote("A: title", "2026-10-11T00:00:00.000Z");
  const values = frontmatter(text)?.values;
  assert.equal(values?.type, undefined);
  assert.equal(values?.title, "A: title");
  assert.equal(values?.captured, "2026-10-11T00:00:00.000Z");
});

test("scratch file names are dated, ASCII slugs and unique", () => {
  assert.equal(
    scratchFileName("Café idea!", "2026-10-11T00:00:00.000Z", []),
    "2026-10-11-cafe-idea.md",
  );
  assert.notEqual(
    scratchFileName("Idea", "2026-10-11T00:00:00.000Z", ["2026-10-11-idea.md"]),
    "2026-10-11-idea.md",
  );
});
