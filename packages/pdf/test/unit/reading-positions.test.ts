import assert from "node:assert/strict";
import { test } from "node:test";
import { PanelPosition } from "../../src/host/viewer/panel-position";
import {
  MAX_POSITIONS,
  PdfViewPreferences,
} from "../../src/host/viewer/preferences";
import type { PdfState } from "../../src/shared/host";
import {
  savedPosition,
  type ReadingPosition,
} from "../../src/shared/reading-position";
import type { ViewState } from "../../src/shared/view-state";

const at = (page: number): ReadingPosition => ({
  page,
  top: 0,
  left: 0,
  zoom: "fitWidth",
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
});

function preferences(initial: Record<string, unknown> = {}) {
  const stored = new Map(Object.entries(initial));
  const state: PdfState = {
    get: (key) => stored.get(key),
    update: async (key, value) => {
      if (value === undefined) {
        stored.delete(key);
      } else {
        stored.set(key, value);
      }
    },
  };
  const prefs = new PdfViewPreferences(
    { get: () => undefined, onChange: () => () => undefined },
    state,
    { all: [] },
  );
  return { prefs, stored };
}

test("every PDF's place is kept in one state entry, and the oldest are forgotten", () => {
  const { prefs, stored } = preferences();
  for (let n = 1; n <= MAX_POSITIONS + 2; n++) {
    prefs.save(`file:///p${n}.pdf`, at(n));
  }
  assert.deepEqual([...stored.keys()], ["lumiere.pdf.readingPositions"]);
  assert.equal(prefs.position("file:///p1.pdf"), undefined);
  assert.equal(prefs.position("file:///p2.pdf"), undefined);
  assert.equal(prefs.position("file:///p3.pdf")?.page, 3);
  // Reading p3 again makes it the most recent: it outlives p4.
  prefs.save("file:///p3.pdf", at(30));
  prefs.save("file:///new.pdf", at(1));
  assert.equal(prefs.position("file:///p3.pdf")?.page, 30);
  assert.equal(prefs.position("file:///p4.pdf"), undefined);
});

test("a place an earlier version kept is read, and its entry goes once saved", () => {
  const legacy = "lumiere.pdf.readingPosition:file:///old.pdf";
  const { prefs, stored } = preferences({ [legacy]: savedPosition(at(7)) });
  assert.equal(prefs.position("file:///old.pdf")?.page, 7);
  prefs.save("file:///old.pdf", at(8));
  assert.equal(stored.has(legacy), false);
  assert.equal(prefs.position("file:///old.pdf")?.page, 8);
});

test("the place is kept once the view is still, not only when the editor closes", async () => {
  const saved: number[] = [];
  const position = new PanelPosition(
    undefined,
    (place) => saved.push(place.page),
    20,
  );
  const view = (page: number) =>
    ({ ...at(page), readingPage: page }) as unknown as ViewState;
  position.viewed(view(2));
  position.viewed(view(3));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(saved, [3]);
  position.dispose();
  assert.deepEqual(saved, [3, 3]);
});
