import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  beginOpening,
  endOpening,
  expectedBlockKinds,
  LONGEST_OPENING_MS,
  OPENING_CLASS,
  REVEAL_MS,
} from "../../../src/webview/opening";
import { FADE_MS, settleSnapshot } from "../../../src/webview/snapshot";
import {
  settledGutters,
  snapshotLayout,
  type SettledGutters,
} from "../../../src/plugins/editor/snapshot-layout";

const css = readFileSync(
  new URL("../../../src/webview/styles/opening.css", import.meta.url),
  "utf8",
);

const ALL: SettledGutters = {
  lineNumbers: true,
  gitGutter: true,
  folding: true,
};

/** A parent whose class list is a set, and a timer that runs when told. */
function marked() {
  const classes = new Set<string>();
  const timers: { run: () => void; ms: number }[] = [];
  return {
    classes,
    parent: {
      classList: {
        add: (name: string) => void classes.add(name),
        remove: (...names: string[]) =>
          void names.forEach((name) => classes.delete(name)),
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
  beginOpening(parent, ALL);
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
  beginOpening(failed.parent, ALL);
  endOpening(
    failed.parent,
    Promise.reject(new Error("chunk")),
    failed.schedule,
  );
  await settled();
  failed.timers.find((timer) => timer.ms === REVEAL_MS)!.run();
  assert.equal(failed.classes.has(OPENING_CLASS), false);

  const stuck = marked();
  beginOpening(stuck.parent, ALL);
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

test("the gutters a note will have are reserved while it opens, and the reserve goes with the opening", async () => {
  const some = marked();
  beginOpening(some.parent, {
    lineNumbers: true,
    gitGutter: false,
    folding: true,
  });
  assert.deepEqual([...some.classes].sort(), [
    "is-opening",
    "opens-with-fold-gutter",
    "opens-with-line-numbers",
  ]);
  endOpening(some.parent, Promise.resolve(), some.schedule);
  await settled();
  some.timers.find((timer) => timer.ms === REVEAL_MS)!.run();
  assert.deepEqual([...some.classes], []);
});

test("a note's settings give the gutter columns it settles with", () => {
  assert.deepEqual(settledGutters({}), ALL);
  // Without settings only the Obsidian preset has its features on.
  assert.deepEqual(settledGutters(undefined, false), {
    lineNumbers: false,
    gitGutter: false,
    folding: false,
  });
  assert.deepEqual(
    settledGutters({
      lineNumbers: { enabled: true, config: { style: "off" } },
      gitGutter: { enabled: false, config: {} },
    }),
    { lineNumbers: false, gitGutter: false, folding: true },
  );
  assert.deepEqual(
    settledGutters({
      lineNumbers: { enabled: true, config: { style: "relative" } },
    }),
    ALL,
  );
});

test("a note awaits the block widgets of the features that are on, and only those", () => {
  assert.deepEqual(expectedBlockKinds({}).sort(), [
    "Table",
    "callout",
    "diagram",
    "embed",
    "math",
    "properties",
  ]);
  assert.deepEqual(
    expectedBlockKinds({
      tables: { enabled: false, config: {} },
      callouts: { enabled: false, config: {} },
      math: { enabled: true, config: {} },
    }).sort(),
    ["diagram", "embed", "math", "properties"],
  );
  // Without the Obsidian preset's defaults a feature must be asked for.
  assert.deepEqual(expectedBlockKinds(undefined, false), []);
  assert.deepEqual(
    expectedBlockKinds({ tables: { enabled: true, config: {} } }, false),
    ["Table"],
  );
});

test("the Properties sheet is awaited only where Properties shows it", () => {
  const properties = (enabled: boolean, display?: string) => ({
    properties: { enabled, config: display ? { display } : {} },
  });
  const awaits = (settings: ReturnType<typeof properties>) =>
    expectedBlockKinds(settings).includes("properties");
  assert.equal(awaits(properties(true, "visible")), true);
  assert.equal(awaits(properties(true)), true);
  assert.equal(awaits(properties(true, "hidden")), false);
  assert.equal(awaits(properties(true, "source")), false);
  assert.equal(awaits(properties(false)), false);
});

test("the gutter reserve's widths are properties of its own strip, and its tests stay shallow", () => {
  // An inherited custom property changed on the scroller as each gutter
  // mounts restyles every element of the note (40 ms of style recalculation
  // at 4x CPU on a note of a few thousand elements), and a `:has()` that
  // looks through the whole subtree is dearer still.
  const rules = [
    ...css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ];
  const declaring = rules.filter(([, , body]) =>
    /--mw-reserve-[a-z]+:/.test(body!),
  );
  assert.ok(declaring.length >= 6);
  for (const [, selector] of declaring) {
    assert.match(
      selector!.trim(),
      /::before$/,
      "the width is set on the strip",
    );
  }
  for (const [, selector] of rules) {
    for (const [, test] of selector!.matchAll(/:has\(([^)]*)\)/g)) {
      assert.match(test!, /^>/, `:has(${test}) looks at children only`);
    }
  }
});
