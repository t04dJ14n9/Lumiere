import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfViewerPanel } from "../../src/host/viewer/panel";
import type { PdfWebview } from "../../src/shared/host";
import type { HostMessage } from "../../src/shared/messages";
import type { SidePanelState } from "../../src/shared/side-panel";
import { parseViewSettings } from "../../src/shared/view-settings";

const OPEN: SidePanelState = { open: true, width: 300, tab: "bookmarks" };

/** The portable panel on a fake page, with a memory for the side panel. */
function open(initial?: SidePanelState) {
  const posted: HostMessage[] = [];
  const remembered: SidePanelState[] = [];
  const events = { changes: 0, refocus: 0 };
  let receive: ((message: unknown) => unknown) | undefined;
  const webview: PdfWebview = {
    cspSource: "'self'",
    asset: (name) => `/pdf/${name}`,
    setHTML: () => undefined,
    post: (message) => posted.push(message),
    onMessage: (listener) => {
      receive = listener;
      return () => undefined;
    },
    deliver: (bytes) => ({ data: bytes }),
  };
  const panel = new PdfViewerPanel(
    "file:///papers/paper.pdf",
    webview,
    {
      files: {
        read: async () => new Uint8Array([37, 80, 68, 70]),
        watch: () => () => undefined,
        displayPath: () => "papers/paper.pdf",
      },
      error: () => undefined,
      openExternal: async () => undefined,
      refocus: () => {
        events.refocus++;
      },
    },
    {
      toolbar: { mode: "chrome", dock: "bottom" },
      settings: parseViewSettings({}),
      position: undefined,
      savePosition: () => undefined,
      ...(initial ? { sidePanel: initial } : {}),
      saveSidePanel: (state) => remembered.push(state),
      route: async () => undefined,
    },
  );
  panel.onDidChange(() => {
    events.changes++;
  });
  return {
    panel,
    posted,
    remembered,
    events,
    receive: (message: unknown) => receive?.(message),
    sidePanelMessages: () =>
      posted.filter((message) => message.type === "sidePanel"),
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("an editor starts with the panel as the last one was left, and closed when nothing was", () => {
  assert.deepEqual(open(OPEN).panel.sidePanel.current, OPEN);
  assert.deepEqual(open().panel.sidePanel.current, {
    open: false,
    width: 240,
    tab: "outline",
  });
});

test("each load carries the panel's state, so the viewer opens as it was left", async () => {
  const h = open(OPEN);
  await h.receive({ type: "ready" });
  const load = h.posted.find((message) => message.type === "load");
  assert.ok(load && load.type === "load");
  assert.deepEqual(load.sidePanel, OPEN);
});

test("what the reader chooses in the viewer is kept, remembered for the next editor and announced, without being sent back", async () => {
  const h = open();
  await h.receive({ type: "ready" });
  const before = h.events.changes;
  await h.receive({
    type: "sidePanel",
    state: { open: true, width: 333, tab: "thumbnails" },
  });
  assert.deepEqual(h.panel.sidePanel.current, {
    open: true,
    width: 333,
    tab: "thumbnails",
  });
  assert.deepEqual(h.remembered, [h.panel.sidePanel.current]);
  assert.equal(h.events.changes, before + 1);
  assert.deepEqual(h.sidePanelMessages(), []);
  // The same state again is no change.
  await h.receive({ type: "sidePanel", state: h.panel.sidePanel.current });
  assert.equal(h.remembered.length, 1);
  assert.equal(h.events.changes, before + 1);
});

test("a state the viewer sends that is not one changes nothing", async () => {
  const h = open(OPEN);
  await h.receive({ type: "sidePanel", state: { open: "yes" } });
  await h.receive({ type: "sidePanel" });
  assert.deepEqual(h.panel.sidePanel.current, OPEN);
  assert.deepEqual(h.remembered, []);
});

test("Toggle opens and closes the panel, tells the viewer, remembers it, and gives the keyboard back", () => {
  const h = open();
  h.panel.sidePanel.toggle();
  assert.equal(h.panel.sidePanel.current.open, true);
  assert.deepEqual(h.sidePanelMessages(), [
    { type: "sidePanel", state: { open: true, width: 240, tab: "outline" } },
  ]);
  assert.equal(h.remembered.length, 1);
  assert.equal(h.events.changes, 1);
  assert.equal(h.events.refocus, 1);
  h.panel.sidePanel.toggle();
  assert.equal(h.panel.sidePanel.current.open, false);
  assert.equal(h.sidePanelMessages().length, 2);
  assert.equal(h.remembered.at(-1)?.open, false);
});

test("a toggle keeps the width and the tab the reader chose", () => {
  const h = open(OPEN);
  h.panel.sidePanel.toggle();
  assert.deepEqual(h.panel.sidePanel.current, { ...OPEN, open: false });
});

test("a viewer made anew, for a changed file or a shown tab, is sent the state as it is now", async () => {
  const h = open();
  h.panel.sidePanel.toggle();
  await h.receive({ type: "ready" });
  await h.receive({ type: "ready" });
  const loads = h.posted.filter((message) => message.type === "load");
  assert.equal(loads.length, 2);
  for (const load of loads) {
    assert.equal(load.type === "load" && load.sidePanel?.open, true);
  }
});

test("the bookmarks the extension reads are sent to the viewer, and again to a viewer made anew", async () => {
  const h = open();
  const items = [
    {
      id: "a",
      title: "The abstract",
      page: 1,
      position: { top: 0, left: 0 },
      created: "2026-11-23T08:00:00.000Z",
    },
  ];
  // Nothing was read yet: nothing to say to a new viewer.
  await h.receive({ type: "ready" });
  assert.equal(h.posted.filter((m) => m.type === "bookmarks").length, 0);
  h.panel.bookmarks.set(items);
  h.panel.bookmarks.set([], "Cannot use the file.");
  assert.deepEqual(
    h.posted.filter((m) => m.type === "bookmarks"),
    [
      { type: "bookmarks", items },
      { type: "bookmarks", items: [], problem: "Cannot use the file." },
    ],
  );
  await h.receive({ type: "ready" });
  await flush();
  const messages = h.posted.filter((m) => m.type === "bookmarks");
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.at(-1), {
    type: "bookmarks",
    items: [],
    problem: "Cannot use the file.",
  });
});

test("Back and Forward being possible is told to the viewer and the menus, once per change, and again to a new viewer", async () => {
  const h = open();
  await h.receive({ type: "ready" });
  const before = h.events.changes;
  h.panel.historyButtons.set(true, false);
  h.panel.historyButtons.set(true, false);
  assert.equal(h.panel.historyButtons.back, true);
  assert.equal(h.panel.historyButtons.forward, false);
  assert.equal(h.events.changes, before + 1);
  assert.equal(h.posted.filter((m) => m.type === "historyState").length, 2);
  await h.receive({ type: "ready" });
  assert.deepEqual(h.posted.filter((m) => m.type === "historyState").at(-1), {
    type: "historyState",
    back: true,
    forward: false,
  });
});
