import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS_BAR_ORDER } from "../../src/extension/plugins/pdfToolbar/status-bar-layout";

test("the status bar has no Annotate button or annotation controls", () => {
  for (const id of STATUS_BAR_ORDER) {
    assert.doesNotMatch(id, /annotat/iu);
  }
  assert.equal(
    STATUS_BAR_ORDER.indexOf("find") + 1,
    STATUS_BAR_ORDER.indexOf("view"),
  );
});
