import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_LAYOUTS } from "../../src/shared/view-options";
import { nativeSpread } from "../../src/webview/spread-mode";

test("page layouts map to the Stage's none, odd (1–2) and even (cover, 2–3) spreads", () => {
  assert.equal(nativeSpread("single"), "none");
  assert.equal(nativeSpread("spread"), "odd");
  assert.equal(nativeSpread("spreadCover"), "even");
  assert.deepEqual(
    PAGE_LAYOUTS.map(({ value }) => nativeSpread(value)),
    ["none", "odd", "even"],
  );
});
