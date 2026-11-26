import assert from "node:assert/strict";
import test from "node:test";
import { modeStatusText } from "./mode-status";

test("the mode entry names the mode and says where a click goes", () => {
  assert.equal(modeStatusText("livePreview").text, "$(eye) Live Preview");
  assert.match(modeStatusText("livePreview").tooltip, /Source mode/);
  assert.equal(modeStatusText("source").text, "$(code) Source");
  assert.match(modeStatusText("source").tooltip, /Live Preview/);
});
