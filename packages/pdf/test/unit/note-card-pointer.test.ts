import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteHover } from "../../src/shared/note-hover";
import { loadModule } from "./support/load-module";

type Listener = (event: never) => void;

interface PointerListeners {
  cardListeners(
    annotation: unknown,
    hover: NoteHover,
    commit: { current: (() => void) | null },
  ): { listeners: [string, Listener][]; stop: () => void };
}

/** The note card's pointer listeners over a page with one mark, noted "Look here", and a frame clock. */
function setUp() {
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  const pointerOver: (string | undefined)[] = [];
  const hover = {
    pointerOver: (key: string | undefined) => void pointerOver.push(key),
    dismiss: () => undefined,
    open: () => undefined,
    editing: () => false,
    shown: () => undefined,
  } as unknown as NoteHover;
  const mark = { ref: { id: "mark-1" }, contents: "Look here" };
  const { cardListeners } = loadModule(
    new URL("../../src/webview/note-card-pointer.ts", import.meta.url),
    {
      react: { useEffect: () => undefined },
      "@embedpdf/engine-core/public": {
        annotationKey: (ref: { id: string }) => ref.id,
      },
      "./look-up-pages": {
        lookUpPageAt: () => ({ page: { ref: {} }, point: { x: 1, y: 1 } }),
      },
      "./note-card-target": {
        isInNoteCard: () => false,
        noteKeyOfBadge: () => undefined,
        scrollsNoteCard: () => false,
      },
    },
    {
      requestAnimationFrame: (run: () => void) => {
        frames.set(++nextFrame, run);
        return nextFrame;
      },
      cancelAnimationFrame: (id: number) => void frames.delete(id),
    },
  ) as unknown as PointerListeners;
  const { listeners } = cardListeners({ getAt: () => mark }, hover, {
    current: null,
  });
  return {
    pointerOver,
    /** Dispatch a pointer event of this type to the listener. */
    emit: (type: string, event: object) =>
      listeners.find(([name]) => name === type)![1](event as never),
    /** The next animation frame, if one is waiting. */
    frame: () => {
      for (const [id, run] of [...frames]) {
        frames.delete(id);
        run();
      }
    },
  };
}

const move = { clientX: 1, clientY: 1, buttons: 0, target: {} };

test("a pointer resting on a mark with a note is reported once a frame", () => {
  const { pointerOver, emit, frame } = setUp();
  emit("pointermove", move);
  assert.deepEqual(pointerOver, []);
  frame();
  assert.deepEqual(pointerOver, ["mark-1"]);
});

test("a frame still waiting when the pointer leaves does not put it back on the mark", () => {
  const { pointerOver, emit, frame } = setUp();
  emit("pointermove", move);
  emit("pointerout", { relatedTarget: null });
  frame();
  assert.deepEqual(pointerOver, [undefined]);
});

test("a pointer that comes back after leaving is reported again", () => {
  const { pointerOver, emit, frame } = setUp();
  emit("pointermove", move);
  emit("pointerout", { relatedTarget: null });
  frame();
  emit("pointermove", move);
  frame();
  assert.deepEqual(pointerOver, [undefined, "mark-1"]);
});

test("moving from one element to another inside the viewer is not leaving it", () => {
  const { pointerOver, emit, frame } = setUp();
  emit("pointermove", move);
  emit("pointerout", { relatedTarget: {} });
  frame();
  assert.deepEqual(pointerOver, ["mark-1"]);
});
