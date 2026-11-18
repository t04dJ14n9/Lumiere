import test from "node:test";
import assert from "node:assert/strict";
import { vimStatusText } from "./status";

test("the status line shows the mode as Vim's panel does, with pending keys", () => {
  assert.equal(vimStatusText(undefined), "-- NORMAL --");
  assert.equal(vimStatusText({}), "-- NORMAL --");
  assert.equal(vimStatusText({ mode: "insert" }), "-- INSERT --");
  assert.equal(vimStatusText({ mode: "visual line" }), "-- VISUAL LINE --");
  assert.equal(
    vimStatusText({ mode: "insert", insertModeReturn: true }),
    "-- INSERT (C-O) --",
  );
  assert.equal(
    vimStatusText({ mode: "normal", status: "d2" }),
    "-- NORMAL --  d2",
  );
});
