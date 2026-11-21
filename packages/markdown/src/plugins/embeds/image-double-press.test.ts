import test from "node:test";
import assert from "node:assert/strict";
import { ImageDoublePress } from "./image-double-press";

const image = { from: 3, to: 13 };
const onImage = { tag: "the image" } as unknown as EventTarget;
const onText = { tag: "its source" } as unknown as EventTarget;

function press(overrides: Partial<MouseEvent> = {}) {
  return {
    detail: 1,
    button: 0,
    clientX: 100,
    clientY: 200,
    timeStamp: 1000,
    target: onImage,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  } as MouseEvent;
}

function setup() {
  const opened: number[] = [];
  let selected: { from: number; to: number } | null = image;
  const presses = new ImageDoublePress({
    selected: () => selected,
    isImageOf: (target, range) =>
      target === onImage && range.from === image.from,
    inspect: () => {
      opened.push(1);
      return true;
    },
  });
  return {
    presses,
    opened,
    deselect: () => {
      selected = null;
    },
  };
}

test("a double-click whose second press misses the image it selected, moved by its source, opens that image's inspector", () => {
  const { presses, opened } = setup();
  assert.equal(presses.opensInspector(press()), false);
  presses.selected(press(), image);
  const second = press({ detail: 2, timeStamp: 1150, target: onText });
  assert.equal(presses.opensInspector(second), true);
  assert.equal(opened.length, 1);
  // A third press is no double-click of its own.
  assert.equal(
    presses.opensInspector(
      press({ detail: 2, timeStamp: 1200, target: onText }),
    ),
    false,
  );
});

test("a second press on the image itself is left to the image's own double-click", () => {
  const { presses, opened } = setup();
  presses.selected(press(), image);
  assert.equal(
    presses.opensInspector(press({ detail: 2, timeStamp: 1150 })),
    false,
  );
  assert.equal(opened.length, 0);
});

test("a press that is no double-click, or after the image was let go, opens nothing", () => {
  for (const [name, second, letGo] of [
    ["a single press", press({ timeStamp: 1150, target: onText }), false],
    ["too late", press({ detail: 2, timeStamp: 2000, target: onText }), false],
    [
      "too far",
      press({ detail: 2, timeStamp: 1150, clientX: 140, target: onText }),
      false,
    ],
    [
      "with a modifier",
      press({ detail: 2, timeStamp: 1150, shiftKey: true, target: onText }),
      false,
    ],
    [
      "image let go",
      press({ detail: 2, timeStamp: 1150, target: onText }),
      true,
    ],
  ] as const) {
    const { presses, opened, deselect } = setup();
    presses.selected(press(), image);
    if (letGo) {
      deselect();
    }
    assert.equal(presses.opensInspector(second), false, name);
    assert.equal(opened.length, 0, name);
  }
});
