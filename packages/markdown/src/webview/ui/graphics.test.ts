import assert from "node:assert/strict";
import test from "node:test";
import { graphicsSanitizerOptions } from "./graphics";

test("default graphics sanitizer forbids foreignObject", () => {
  const options = graphicsSanitizerOptions();
  assert.deepEqual(options.ADD_TAGS, ["mjx-container", "use"]);
  assert.deepEqual(options.ADD_ATTR, ["xlink:href"]);
  assert.equal(options.HTML_INTEGRATION_POINTS, undefined);
  assert.ok(options.FORBID_TAGS?.includes("foreignObject"));
  for (const tag of ["script", "iframe", "object", "embed", "form"]) {
    assert.ok(options.FORBID_TAGS?.includes(tag));
  }
});

test("Mermaid sanitizer preserves foreignObject HTML labels without relaxing active-tag bans", () => {
  const options = graphicsSanitizerOptions({ allowForeignObject: true });
  assert.deepEqual(options.ADD_TAGS, ["mjx-container", "use", "foreignObject"]);
  assert.deepEqual(options.ADD_ATTR, [
    "xlink:href",
    "xmlns",
    "dominant-baseline",
  ]);
  assert.deepEqual(options.HTML_INTEGRATION_POINTS, { foreignobject: true });
  assert.equal(options.FORBID_TAGS?.includes("foreignObject"), false);
  assert.deepEqual(options.FORBID_TAGS, [
    "script",
    "iframe",
    "object",
    "embed",
    "form",
  ]);
});
