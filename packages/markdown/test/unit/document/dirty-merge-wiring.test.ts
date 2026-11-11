import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const markdownRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const notePath = join(markdownRoot, "docs/dirty-merge-wiring.md");
const authorityPath = join(markdownRoot, "src/shared/document/authority.ts");

test("Authority exposes prepare and record, not publish", () => {
  const authority = readFileSync(authorityPath, "utf8");
  assert.match(authority, /^\s+prepare\(/m);
  assert.match(authority, /^\s+record\(/m);
  assert.doesNotMatch(authority, /^\s+publish\s*\(/m);
});

test("wiring note does not tell a follow-up to call nonexistent publish", () => {
  const note = readFileSync(notePath, "utf8");
  assert.doesNotMatch(note, /`prepare` \+ `publish`/);
  assert.match(note, /`Authority` has no `publish` method/);
  assert.match(note, /`Authority\.record`/);
});

test("wiring note sets lastSaved to the observed disk hostText", () => {
  const note = readFileSync(notePath, "utf8");
  assert.doesNotMatch(note, /Update `lastSaved` to the merged host text/);
  assert.match(
    note,
    /set `lastSaved` to the disk `hostText` just observed/,
  );
  assert.match(note, /not to the merge-result string/);
});
