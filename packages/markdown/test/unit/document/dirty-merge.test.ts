import test from "node:test";
import assert from "node:assert/strict";
import { mergeExternalChange } from "../../../src/plugins/document/dirty-merge";

test("no-op when the buffer equals disk", () => {
  // Buffer and disk already agree with each other (both moved past the save),
  // so there is no host change to merge and no unsaved diff to re-apply.
  const result = mergeExternalChange({
    lastSaved: "one\ntwo\nthree",
    authority: "one\ntwo\nthree\nEXTERNAL",
    hostText: "one\ntwo\nthree\nEXTERNAL",
  });
  assert.equal(result, "one\ntwo\nthree\nEXTERNAL");
});

test("clean replace adopts the host rewrite", () => {
  // The buffer is clean (no edits since the save): the external rewrite wins.
  const result = mergeExternalChange({
    lastSaved: "one\ntwo\nthree",
    authority: "one\ntwo\nthree",
    hostText: "one\ntwo\nTHREE",
  });
  assert.equal(result, "one\ntwo\nTHREE");
});

test("dirty merge preserves both sides' edits", () => {
  // The user edited line 1 since the save; an external program edited line 3.
  // Both must survive. Returning `hostText` (old behaviour) would drop "ONE".
  const result = mergeExternalChange({
    lastSaved: "one\ntwo\nthree",
    authority: "ONE\ntwo\nthree",
    hostText: "one\ntwo\nTHREE",
  });
  assert.equal(result, "ONE\ntwo\nTHREE");
});

test("own-save echo keeps the unsaved edits", () => {
  // Disk bounced back to exactly the last saved text (an echo of our own
  // save): there is no external change, so the unsaved typing is kept.
  const result = mergeExternalChange({
    lastSaved: "one\ntwo\nthree",
    authority: "ONE\ntwo\nthree",
    hostText: "one\ntwo\nthree",
  });
  assert.equal(result, "ONE\ntwo\nthree");
});

test("an external insert shifts a later local edit", () => {
  // Rebasing must follow the host's inserted line, not apply the local edit
  // at its stale offset (which would change "b" instead of "c").
  const result = mergeExternalChange({
    lastSaved: "a\nb\nc",
    authority: "a\nb\nC",
    hostText: "a\nB\nb\nc",
  });
  assert.equal(result, "a\nB\nb\nC");
});

test("an external delete shifts a later local edit", () => {
  const result = mergeExternalChange({
    lastSaved: "a\nb\nc\nd",
    authority: "a\nb\nc\nD",
    hostText: "b\nc\nd",
  });
  assert.equal(result, "b\nc\nD");
});

test("both sides insert in different places", () => {
  const result = mergeExternalChange({
    lastSaved: "a\nb",
    authority: "a\nX\nb",
    hostText: "a\nb\nY",
  });
  assert.equal(result, "a\nX\nb\nY");
});

test("CRLF host text is normalized to LF", () => {
  // VS Code documents may use CRLF while the collab buffer uses LF. The merge
  // must not treat every line as rewritten.
  const result = mergeExternalChange({
    lastSaved: "one\ntwo\nthree",
    authority: "ONE\ntwo\nthree",
    hostText: "one\r\ntwo\r\nTHREE",
  });
  assert.equal(result, "ONE\ntwo\nTHREE");
});
