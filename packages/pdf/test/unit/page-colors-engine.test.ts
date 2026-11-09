import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAGE_COLORS_ENGINE_AVAILABLE,
  renderablePageColors,
} from "../../src/shared/page-colors-engine";

test("EmbedPDF 3 has no page color-scheme: dark intent still renders normal", () => {
  assert.equal(PAGE_COLORS_ENGINE_AVAILABLE, false);
  assert.equal(renderablePageColors("dark"), "normal");
  assert.equal(renderablePageColors("normal"), "normal");
});
