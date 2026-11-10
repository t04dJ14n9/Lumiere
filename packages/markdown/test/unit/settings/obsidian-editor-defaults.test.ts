import test from "node:test";
import assert from "node:assert/strict";
import { contributions } from "../../../scripts/contributions";

test("fresh-profile editor defaults match Obsidian 1.15.0", async () => {
  const properties = (await contributions()).configuration.properties as Record<
    string,
    { default: unknown; scope: string }
  >;
  assert.equal(
    properties["lumiere.markdown.editor.readableLineLength"]?.default,
    true,
    "readable line length is on",
  );
  assert.equal(
    properties["lumiere.markdown.plugins.inlineTitle.enabled"]?.default,
    true,
    "inline title is on",
  );
  assert.equal(
    properties["lumiere.markdown.plugins.lineNumbers.enabled"]?.default,
    false,
    "line numbers are off",
  );
});
