import test from "node:test";
import assert from "node:assert/strict";
import { editorFrameSandbox } from "../../src/shell/editor-sandbox";
import { PLAYER_SANDBOX } from "../../../markdown/src/plugins/onlineVideos/player";

const flags = (kind: Parameters<typeof editorFrameSandbox>[0]) =>
  new Set(editorFrameSandbox(kind).split(" "));

test("a page may not navigate the window, download, or open dialogs", () => {
  for (const kind of ["note", "pdf"] as const) {
    const sandbox = flags(kind);
    for (const flag of [
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-top-navigation-to-custom-protocols",
      "allow-downloads",
      "allow-modals",
      "allow-pointer-lock",
    ]) {
      assert.equal(sandbox.has(flag), false, `${kind}: ${flag}`);
    }
  }
});

test("a page keeps its scripts, its origin and its web links", () => {
  for (const kind of ["note", "pdf"] as const) {
    const sandbox = flags(kind);
    for (const flag of [
      "allow-scripts",
      "allow-same-origin",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
    ]) {
      assert.ok(sandbox.has(flag), `${kind}: ${flag}`);
    }
  }
});

test("a video player's frame in a note keeps every flag it asks for", () => {
  // A frame's sandbox is its own flags within its parent's.
  const note = flags("note");
  for (const flag of PLAYER_SANDBOX.split(" ")) {
    assert.ok(note.has(flag), flag);
  }
});

test("only a PDF's page may submit a form: its password prompt", () => {
  assert.ok(flags("pdf").has("allow-forms"));
  assert.equal(flags("note").has("allow-forms"), false);
});
