import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  beginOpening,
  endOpening,
  LONGEST_OPENING_MS,
  OPENING_CLASS,
  REVEAL_MS,
} from "../../../src/webview/opening";
import { FADE_MS, settleSnapshot } from "../../../src/webview/snapshot";
import { snapshotLayout } from "../../../src/plugins/editor/snapshot-layout";

const css = readFileSync(
  new URL("../../../src/webview/styles/opening.css", import.meta.url),
  "utf8",
);

/** A parent whose class list is a set, and a timer that runs when told. */
function marked() {
  const classes = new Set<string>();
  const timers: { run: () => void; ms: number }[] = [];
  return {
    classes,
    parent: {
      classList: {
        add: (name: string) => void classes.add(name),
        remove: (name: string) => void classes.delete(name),
      },
    },
    schedule: (run: () => void, ms: number) => void timers.push({ run, ms }),
    timers,
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("the opening is marked from the start and cleared a reveal after the features load", async () => {
  const { classes, parent, schedule, timers } = marked();
  let load!: () => void;
  beginOpening(parent);
  assert.equal(classes.has(OPENING_CLASS), true);
  endOpening(
    parent,
    new Promise<void>((resolve) => (load = resolve)),
    schedule,
  );
  assert.deepEqual(
    timers.map((timer) => timer.ms),
    [LONGEST_OPENING_MS],
    "only the last-resort timer runs while features load",
  );
  load();
  await settled();
  assert.equal(classes.has(OPENING_CLASS), true, "the reveal is not over");
  assert.deepEqual(
    timers.map((timer) => timer.ms),
    [LONGEST_OPENING_MS, REVEAL_MS],
  );
  timers[1]!.run();
  assert.equal(classes.has(OPENING_CLASS), false);
});

test("features that fail, or never load, do not leave the note opening", async () => {
  const failed = marked();
  beginOpening(failed.parent);
  endOpening(
    failed.parent,
    Promise.reject(new Error("chunk")),
    failed.schedule,
  );
  await settled();
  failed.timers.find((timer) => timer.ms === REVEAL_MS)!.run();
  assert.equal(failed.classes.has(OPENING_CLASS), false);

  const stuck = marked();
  beginOpening(stuck.parent);
  endOpening(stuck.parent, new Promise(() => {}), stuck.schedule);
  stuck.timers.find((timer) => timer.ms === LONGEST_OPENING_MS)!.run();
  assert.equal(stuck.classes.has(OPENING_CLASS), false);
});

test("reveals animate only while the note is opening, and never without motion", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*animation:[^{}]*)\}/g)];
  assert.ok(rules.length > 0);
  for (const [, selector] of rules) {
    const names = selector!.trim();
    if (!names.startsWith("@keyframes") && !names.startsWith("*")) {
      assert.match(
        names,
        /^\.is-opening\b/,
        "animations sit under .is-opening",
      );
    }
  }
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[^]*\.is-opening \* \{\s*animation: none !important;/,
  );
  assert.match(css, /--mw-reveal-ms: 100ms;/);
  assert.equal(REVEAL_MS, 100);
  assert.equal(FADE_MS, REVEAL_MS);
});

test("a reveal starts from partly visible, and the fading snapshot takes no pointer events", () => {
  for (const [, from] of css.matchAll(/opacity: (0\.\d+)/g)) {
    assert.ok(Number(from) >= 0.4, `starts at ${from}`);
  }
  const base = readFileSync(
    new URL("../../../src/plugins/editor/snapshot.css", import.meta.url),
    "utf8",
  );
  assert.match(base, /\.mw-snapshot \{[^}]*pointer-events: none;/);
});

/** A snapshot element and the parent that finds it. */
function covered(reduced: boolean) {
  const classes = new Set<string>();
  const listeners: Record<string, () => void> = {};
  let isRemoved = false;
  const snapshot = {
    dataset: { layout: "" },
    classList: { add: (name: string) => void classes.add(name) },
    addEventListener: (type: string, run: () => void) =>
      void (listeners[type] = run),
    remove: () => void (isRemoved = true),
    ownerDocument: {
      defaultView: { matchMedia: () => ({ matches: reduced }) },
    },
  };
  return {
    classes,
    listeners,
    isRemoved: () => isRemoved,
    parent: { ownerDocument: { querySelector: () => snapshot } } as never,
    snapshot,
  };
}

const NOTE = { preset: "obsidian", mode: "livePreview" } as const;

test("the snapshot fades into the editor, which is live beneath it, and goes when the fade ends", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const key = snapshotLayout(NOTE, "mac")!.key;
    const view = covered(false);
    view.snapshot.dataset.layout = key;
    let load!: () => void;
    settleSnapshot(
      view.parent,
      NOTE,
      new Promise<void>((resolve) => (load = resolve)),
    );
    assert.equal(
      view.classes.has("is-leaving"),
      false,
      "it covers until the features are in",
    );
    load();
    await settled();
    assert.equal(view.classes.has("is-leaving"), true);
    assert.equal(view.isRemoved(), false, "it fades first");
    view.listeners.transitionend!();
    assert.equal(view.isRemoved(), true);
  } finally {
    mock.timers.reset();
  }
});

test("a snapshot whose transition never ends still goes, and goes at once without motion", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const key = snapshotLayout(NOTE, "mac")!.key;
    const slow = covered(false);
    slow.snapshot.dataset.layout = key;
    settleSnapshot(slow.parent, NOTE, Promise.resolve());
    await settled();
    mock.timers.tick(FADE_MS + 50);
    assert.equal(slow.isRemoved(), true);

    const still = covered(true);
    still.snapshot.dataset.layout = key;
    settleSnapshot(still.parent, NOTE, Promise.resolve());
    await settled();
    assert.equal(still.isRemoved(), true);
    assert.equal(still.classes.has("is-leaving"), false);
  } finally {
    mock.timers.reset();
  }
});

test("a snapshot for other settings goes at once, unfaded", () => {
  const view = covered(false);
  view.snapshot.dataset.layout = "another layout";
  settleSnapshot(view.parent, NOTE, new Promise(() => {}));
  assert.equal(view.isRemoved(), true);
});
