import assert from "node:assert/strict";
import { test } from "node:test";
import { parseViewerMessage } from "../../src/shared/messages";
import {
  MAX_PANEL_BOOKMARKS,
  parseBookmarkList,
  parseBookmarksProblem,
} from "../../src/shared/side-panel-messages";

const bookmark = (id: string, page = 1) => ({
  id,
  title: `Bookmark ${id}`,
  page,
  position: { top: 10, left: 0 },
  created: "2026-11-23T08:00:00.000Z",
});

test("the viewer's side panel state is accepted when well-formed, with the width kept in range", () => {
  assert.deepEqual(
    parseViewerMessage({
      type: "sidePanel",
      state: { open: true, width: 9999, tab: "annotations" },
    }),
    {
      type: "sidePanel",
      state: { open: true, width: 640, tab: "annotations" },
    },
  );
});

test("a side panel state that is not one is refused", () => {
  for (const state of [undefined, null, "open", 1, {}, { open: "yes" }, []]) {
    assert.equal(
      parseViewerMessage({ type: "sidePanel", state }),
      undefined,
      JSON.stringify(state),
    );
  }
});

test("Add Bookmark needs nothing more; Rename and Delete need the bookmark's id", () => {
  assert.deepEqual(
    parseViewerMessage({ type: "bookmarkAction", action: "add", id: "x" }),
    { type: "bookmarkAction", action: "add" },
  );
  for (const action of ["rename", "delete"] as const) {
    assert.deepEqual(
      parseViewerMessage({ type: "bookmarkAction", action, id: "b-1" }),
      { type: "bookmarkAction", action, id: "b-1" },
    );
    for (const id of [undefined, "", 7, null, "x".repeat(201)]) {
      assert.equal(
        parseViewerMessage({ type: "bookmarkAction", action, id }),
        undefined,
        `${action} ${String(id).slice(0, 5)}`,
      );
    }
  }
  assert.equal(
    parseViewerMessage({ type: "bookmarkAction", action: "go", id: "b" }),
    undefined,
  );
  assert.equal(parseViewerMessage({ type: "bookmarkAction" }), undefined);
});

test("the bookmarks a message carries are the entries that are bookmarks, once each", () => {
  assert.deepEqual(
    parseBookmarkList([
      bookmark("a"),
      { id: "broken" },
      bookmark("a", 9),
      "text",
      bookmark("b", 2),
    ]).map((entry) => [entry.id, entry.page]),
    [
      ["a", 1],
      ["b", 2],
    ],
  );
  assert.deepEqual(parseBookmarkList("not a list"), []);
  assert.deepEqual(parseBookmarkList(undefined), []);
});

test("a list longer than any reader keeps is cut", () => {
  const many = Array.from({ length: MAX_PANEL_BOOKMARKS + 50 }, (_, index) =>
    bookmark(`id-${index}`),
  );
  assert.equal(parseBookmarkList(many).length, MAX_PANEL_BOOKMARKS);
});

test("the problem is text, cut to a sane length", () => {
  assert.equal(parseBookmarksProblem("It is damaged."), "It is damaged.");
  assert.equal(parseBookmarksProblem(""), undefined);
  assert.equal(parseBookmarksProblem(12), undefined);
  assert.equal(parseBookmarksProblem("x".repeat(900))?.length, 500);
});
