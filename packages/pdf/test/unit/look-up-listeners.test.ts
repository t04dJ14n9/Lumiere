import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as words from "../../src/shared/look-up";
import * as boxes from "../../src/webview/text-boxes";

/** A glyph cell, the way EmbedPDF reads a page's text geometry. */
const cell = (x: number, width: number) => ({
  loose: { x, y: 0, width, height: 10 },
  tight: { x, y: 0, width, height: 10 },
});

/** "alpha" at x 0 to 8, a space, "beta" at x 10 to 18: one character each. */
const layout = {
  charCount: 3,
  runs: [
    {
      start: 0,
      rect: { x: 0, y: 0, width: 18, height: 10 },
      glyphs: [
        cell(0, 8),
        { ...cell(8, 2), space: true as const },
        cell(10, 8),
      ],
    },
  ],
  // Like EmbedPDF's, it forgives a near miss: the nearest glyph within reach.
  charAt: (point: { x: number; y: number }) =>
    point.y < -5 || point.y > 15 ? null : point.x < 9 ? 0 : 2,
  wordAt: (at: number) => ({ start: at, count: 1 }),
  segments: (range: { start: number }) => [
    { rect: { x: range.start === 0 ? 0 : 10, y: 0, width: 8, height: 10 } },
  ],
};

function harness() {
  const listeners = new Map<
    string,
    (event: { clientX: number; clientY: number; buttons?: number }) => void
  >();
  const messages: { word: string | null; open: boolean }[] = [];
  const targets: ({ text: string } | undefined)[] = [];
  let timer: (() => void) | undefined;
  let dispose = () => {};
  let top = 0;
  let pending: (() => void)[] | undefined;
  let camera: (() => void) | undefined;
  const text = {
    layoutOf: async () => layout,
    slice: (_page: unknown, range: { start: number }) =>
      new Promise<string>((resolve) => {
        const complete = () => resolve(range.start === 0 ? "alpha" : "beta");
        if (pending) {
          pending.push(complete);
        } else {
          complete();
        }
      }),
  };
  const stage = {
    onCameraChanged: (listener: () => void) => {
      camera = listener;
      return () => {
        camera = undefined;
      };
    },
  };
  const modules: Record<string, unknown> = {
    react: {
      useCallback: (callback: unknown) => callback,
      useRef: (current: unknown) => ({ current }),
      useEffect: (effect: () => () => void) => {
        dispose = effect();
      },
    },
    "@embedpdf/react/runtime": { useOptionalCapability: () => stage },
    "@embedpdf/plugin-stage/contract": { StageToken: {} },
    "./text-access": { useTextAccess: () => text },
    "./text-boxes": boxes,
    // One page, 100 points wide, at one pixel per point.
    "./look-up-pages": {
      lookUpPageAt: (x: number, y: number) => ({
        page: { pageIndex: 0, ref: { kind: "objectNumber", objectNumber: 3 } },
        point: { x, y: y - top },
      }),
    },
    "../shared/look-up": words,
    "./look-up-target": {
      setLookUpTarget: (target: { text: string } | undefined) =>
        targets.push(target),
    },
    "./host": {
      postToHost: (message: { word: string | null; open: boolean }) =>
        messages.push(message),
    },
  };
  const source = readFileSync(
    new URL("../../src/webview/look-up.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = {
    exports: {} as { useLookUp(enabled: boolean): () => void },
  };
  const evaluate = runInNewContext(
    `(function(require,module,exports){${output}\n})`,
    {
      document: {
        addEventListener: (
          name: string,
          fn: (event: { clientX: number; clientY: number }) => void,
        ) => listeners.set(name, fn),
        removeEventListener: (name: string) => listeners.delete(name),
      },
      setTimeout: (fn: () => void) => {
        timer = fn;
        return 1;
      },
      clearTimeout: () => {
        timer = undefined;
      },
    },
  ) as (
    require: (name: string) => unknown,
    module: unknown,
    exports: unknown,
  ) => void;
  evaluate(
    (name) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    module,
    module.exports,
  );
  const open = module.exports.useLookUp(true);
  return {
    open,
    messages,
    /** The hidden word's text after each change, or undefined when none. */
    shown: () => targets.at(-1)?.text,
    emit: (name: string, x = 2, buttons = 0) => {
      if (name === "scroll") {
        // The pages move with the Stage's camera, not by scrolling.
        camera?.();
        return;
      }
      listeners.get(name)?.({ clientX: x, clientY: 5, buttons } as never);
    },
    hover: () => {
      const run = timer;
      timer = undefined;
      run?.();
    },
    movePage: () => {
      top = 30;
    },
    hold: () => {
      pending = [];
      return pending;
    },
    dispose: () => dispose(),
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("context click resolves the exact neighboring word and owns it over later hover", async () => {
  const h = harness();
  h.emit("pointermove");
  h.hover();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "alpha");
  h.emit("contextmenu", 12);
  h.emit("pointermove", 2);
  h.hover();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "beta");
  h.dispose();
});
test("scroll and changed geometry invalidate an in-flight clicked word", async () => {
  const h = harness();
  const pending = h.hold();
  h.emit("contextmenu");
  await tick();
  h.movePage();
  h.emit("scroll");
  pending.forEach((done) => done());
  await tick();
  assert.equal(h.messages.at(-1)?.word, null);
  h.dispose();
});
test("newer clicks win out of order and disposed listeners never publish", async () => {
  const h = harness();
  const pending = h.hold();
  h.emit("contextmenu");
  await tick();
  h.emit("contextmenu", 12);
  await tick();
  pending[1]!();
  await tick();
  pending[0]!();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "beta");
  h.emit("contextmenu");
  await tick();
  const count = h.messages.length;
  h.dispose();
  pending[2]!();
  await tick();
  assert.equal(h.messages.length, count);
});

test("scrolling tells the host nothing: a camera event for every wheel event is no message each", async () => {
  const h = harness();
  for (let move = 0; move < 30; move++) {
    h.emit("scroll");
  }
  assert.equal(
    h.messages.length,
    0,
    "no word was reported, so none is retracted",
  );
  h.emit("pointermove");
  h.hover();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "alpha");
  const reported = h.messages.length;
  h.emit("scroll");
  assert.equal(
    h.messages.length,
    reported + 1,
    "the first move retracts the word",
  );
  assert.equal(h.messages.at(-1)?.word, null);
  assert.equal(h.messages.at(-1)?.open, false);
  for (let move = 0; move < 30; move++) {
    h.emit("scroll");
  }
  assert.equal(
    h.messages.length,
    reported + 1,
    "and the moves after it say nothing",
  );
  h.dispose();
});

test("the native command resolves the saved click, not a later hover point", async () => {
  const h = harness();
  h.emit("contextmenu", 12);
  h.emit("pointermove", 2);
  h.open();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "beta");
  assert.equal(h.messages.at(-1)?.open, true);
  h.emit("scroll");
  const count = h.messages.length;
  h.open();
  await tick();
  assert.equal(h.messages.length, count);
  h.dispose();
});

test("the word the pointer rests on is shown as hidden text for the system's Look Up", async () => {
  const h = harness();
  h.emit("pointermove");
  h.hover();
  await tick();
  assert.equal(h.shown(), "alpha");
  h.emit("pointermove", 12);
  h.hover();
  await tick();
  assert.equal(h.shown(), "beta");
  h.dispose();
  assert.equal(h.shown(), undefined, "turning Look Up off removes it");
});

test("a press keeps the hidden word, or places it at once, and a drag does not move it", async () => {
  const h = harness();
  h.emit("pointermove");
  h.hover();
  await tick();
  h.emit("pointerdown");
  await tick();
  assert.equal(h.shown(), "alpha", "the press began on the shown word");
  h.emit("pointerdown", 12);
  await tick();
  assert.equal(h.shown(), "beta", "a press too quick for the hover places it");
  h.emit("pointermove", 2, 1);
  h.hover();
  await tick();
  assert.equal(h.shown(), "beta", "dragging leaves it under the press");
  h.emit("scroll");
  assert.equal(h.shown(), "beta", "a scroll mid-drag leaves it too");
  h.emit("pointerup");
  h.emit("scroll");
  assert.equal(h.shown(), undefined, "a scroll moves the word away");
  h.hover();
  await tick();
  assert.equal(
    h.shown(),
    "alpha",
    "and it is found again where the pointer rests",
  );
  h.dispose();
});

test("beside a word, where EmbedPDF's hit test still forgives, there is no word", async () => {
  const h = harness();
  h.emit("pointermove", 8.4);
  h.hover();
  await tick();
  assert.equal(h.messages.at(-1)?.word, "alpha", "half a point off: on it");
  h.emit("pointermove", 8.8);
  h.hover();
  await tick();
  assert.equal(h.messages.at(-1)?.word, null, "the gap after it: on none");
  assert.equal(h.shown(), undefined);
  h.dispose();
});
