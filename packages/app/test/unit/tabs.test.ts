import test from "node:test";
import assert from "node:assert/strict";
import {
  liveNoteTabs,
  MAX_LIVE_EDITORS,
  noTabs,
  restoreTabs,
  SETTINGS_TAB,
  tabId,
  tabsReducer,
  tabTitle,
  tabToClose,
  tabsToSave,
  type TabsState,
} from "../../src/shell/tabs";
import { renameAction } from "../../src/shell/opening";

const open = (state: TabsState, path: string, vault = "/v") =>
  tabsReducer(state, { type: "open", vault, path });

test("opening a file twice shows its one tab", () => {
  let state = open(noTabs, "a.md");
  state = open(state, "b.md");
  state = open(state, "a.md");
  assert.deepEqual(
    state.tabs.map((tab) => tabTitle(tab)),
    ["a", "b"],
  );
  assert.equal(state.active, tabId("/v", "a.md"));
  // The same path in another vault is another tab.
  assert.equal(open(state, "a.md", "/w").tabs.length, 3);
});

test("closing the shown tab shows its right neighbour, else its left one", () => {
  let state = ["a.md", "b.md", "c.md"].reduce(
    (s, path) => open(s, path),
    noTabs,
  );
  state = tabsReducer(state, { type: "activate", id: tabId("/v", "b.md") });
  state = tabsReducer(state, { type: "close", id: tabId("/v", "b.md") });
  assert.equal(state.active, tabId("/v", "c.md"));
  state = tabsReducer(state, { type: "close", id: tabId("/v", "c.md") });
  assert.equal(state.active, tabId("/v", "a.md"));
  state = tabsReducer(state, { type: "close", id: tabId("/v", "a.md") });
  assert.deepEqual(state, noTabs);
});

test("closing a hidden tab keeps the shown one; unknown ids change nothing", () => {
  let state = ["a.md", "b.md"].reduce((s, path) => open(s, path), noTabs);
  state = tabsReducer(state, { type: "close", id: tabId("/v", "a.md") });
  assert.equal(state.active, tabId("/v", "b.md"));
  assert.equal(tabsReducer(state, { type: "close", id: "nope" }), state);
  assert.equal(tabsReducer(state, { type: "activate", id: "nope" }), state);
});

test("Settings opens once, as a tab beside the notes, and closes like one", () => {
  let state = open(noTabs, "a.md");
  state = tabsReducer(state, { type: "openSettings" });
  state = tabsReducer(state, { type: "activate", id: tabId("/v", "a.md") });
  state = tabsReducer(state, { type: "openSettings" });
  assert.deepEqual(
    state.tabs.map((tab) => tabTitle(tab)),
    ["a", "Settings"],
  );
  assert.equal(state.active, SETTINGS_TAB);
  state = tabsReducer(state, { type: "close", id: SETTINGS_TAB });
  assert.equal(state.active, tabId("/v", "a.md"));
});

test("⌘W closes the shown tab while there are others, and leaves the last to the window", () => {
  assert.equal(tabToClose(noTabs), undefined);
  const one = open(noTabs, "a.md");
  assert.equal(tabToClose(one), undefined);
  const two = open(one, "b.md");
  assert.equal(tabToClose(two), tabId("/v", "b.md"));
  const back = tabsReducer(two, { type: "activate", id: tabId("/v", "a.md") });
  assert.equal(tabToClose(back), tabId("/v", "a.md"));
});

test("⌃⇥ goes back to the tab shown before, so it switches between two", () => {
  let state = ["a.md", "b.md", "c.md"].reduce(
    (s, path) => open(s, path),
    noTabs,
  );
  state = tabsReducer(state, { type: "activate", id: tabId("/v", "a.md") });
  state = tabsReducer(state, { type: "last" });
  assert.equal(state.active, tabId("/v", "c.md"));
  state = tabsReducer(state, { type: "last" });
  assert.equal(state.active, tabId("/v", "a.md"));
  // Closing the shown tab forgets it: back to the one before.
  state = tabsReducer(state, { type: "close", id: tabId("/v", "a.md") });
  state = tabsReducer(state, { type: "last" });
  assert.notEqual(state.active, tabId("/v", "a.md"));
  assert.equal(tabsReducer(noTabs, { type: "last" }), noTabs);
});

test("next and previous step through the tabs in order, wrapping", () => {
  let state = ["a.md", "b.md", "c.md"].reduce(
    (s, path) => open(s, path),
    noTabs,
  );
  state = tabsReducer(state, { type: "step", by: 1 });
  assert.equal(state.active, tabId("/v", "a.md"));
  state = tabsReducer(state, { type: "step", by: -1 });
  assert.equal(state.active, tabId("/v", "c.md"));
  state = tabsReducer(state, { type: "step", by: -1 });
  assert.equal(state.active, tabId("/v", "b.md"));
});

test("a sketch goes into a Markdown note, not a PDF or Settings", async () => {
  const { takesSketch } = await import("../../src/shell/tabs");
  const note = (path: string) => ({
    kind: "note" as const,
    id: path,
    vault: "/v",
    path,
  });
  assert.equal(takesSketch(note("Daily/2026-10-26.md")), true);
  assert.equal(takesSketch(note("Notes/Plan.markdown")), true);
  assert.equal(takesSketch(note("Attachments/Field handbook.pdf")), false);
  assert.equal(takesSketch({ kind: "settings", id: SETTINGS_TAB }), false);
  assert.equal(takesSketch(undefined), false);
});

test("the open notes are kept for the next launch and reopen there, the shown one shown", () => {
  let state = open(noTabs, "a.md");
  state = open(state, "b.md", "/w");
  state = tabsReducer(state, { type: "openSettings" });
  state = tabsReducer(state, { type: "activate", id: tabId("/v", "a.md") });
  const saved = tabsToSave(state);
  assert.deepEqual(saved, {
    tabs: [
      { vault: "/v", path: "a.md" },
      { vault: "/w", path: "b.md" },
    ],
    activeTab: 0,
  });

  const reopened = restoreTabs(saved, ["/v", "/w"]).reduce(tabsReducer, noTabs);
  assert.deepEqual(
    reopened.tabs.map((tab) => tab.id),
    [tabId("/v", "a.md"), tabId("/w", "b.md")],
  );
  assert.equal(reopened.active, tabId("/v", "a.md"));

  // A vault that did not open again keeps its tabs closed.
  const onlyW = restoreTabs(saved, ["/w"]).reduce(tabsReducer, noTabs);
  assert.deepEqual(
    onlyW.tabs.map((tab) => tab.id),
    [tabId("/w", "b.md")],
  );
});

test("F36: tabs follow a moved file or folder, keeping their places, and close with a deleted one", () => {
  let state = open(noTabs, "a/x.md");
  state = open(state, "b.md");
  state = open(state, "a/y.md");
  state = open(state, "b.md");
  state = tabsReducer(state, {
    type: "moved",
    vault: "/v",
    from: "a",
    to: "c/a",
  });
  assert.deepEqual(
    state.tabs.map((tab) => tab.kind === "note" && tab.path),
    ["c/a/x.md", "b.md", "c/a/y.md"],
  );
  assert.equal(state.active, tabId("/v", "b.md"));
  assert.deepEqual(state.recent, [
    tabId("/v", "b.md"),
    tabId("/v", "c/a/y.md"),
    tabId("/v", "c/a/x.md"),
  ]);
  // "ab.md" is not in folder "a"; another vault's "a" is not this one.
  const other = open(open(noTabs, "ab.md"), "a/x.md", "/w");
  assert.deepEqual(
    tabsReducer(other, { type: "moved", vault: "/v", from: "a", to: "z" }),
    other,
  );
  state = tabsReducer(state, { type: "removed", vault: "/v", path: "c" });
  assert.deepEqual(
    state.tabs.map((tab) => tab.kind === "note" && tab.path),
    ["b.md"],
  );
});

test("F36: a rename the server announces moves the tabs of the open vault that holds it", () => {
  assert.deepEqual(
    renameAction({ from: "/v/a/x.md", to: "/v/b/x.md" }, ["/w", "/v"]),
    { type: "moved", vault: "/v", from: "a/x.md", to: "b/x.md" },
  );
  assert.equal(
    renameAction({ from: "/elsewhere/x.md", to: "/v/x.md" }, ["/v"]),
    undefined,
  );
});

test("P26: only the pages of the shown tab and those shown last stay loaded", () => {
  let state = noTabs;
  for (const name of ["a", "b", "c", "d", "e", "f", "g"]) {
    state = open(state, `${name}.md`);
  }
  state = tabsReducer(state, { type: "openSettings" });
  state = open(state, "b.md");
  const live = liveNoteTabs(state, 3);
  assert.deepEqual(
    [...live],
    [tabId("/v", "b.md"), tabId("/v", "g.md"), tabId("/v", "f.md")],
  );
  // Settings is no page, and a window with few tabs keeps every one.
  assert.equal(live.has(SETTINGS_TAB), false);
  assert.equal(liveNoteTabs(open(noTabs, "a.md")).size, 1);
  assert.equal(MAX_LIVE_EDITORS, 5);
  assert.equal(liveNoteTabs(state).size, 5);
});
