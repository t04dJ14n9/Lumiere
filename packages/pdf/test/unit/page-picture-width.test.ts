import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PICTURE_WIDTH,
  MIN_PICTURE_WIDTH,
  pagePictureWidth,
} from "../../src/shared/page-picture-width";

test("a picture is as wide as the pane has device pixels", () => {
  assert.equal(pagePictureWidth({ cssWidth: 1200, pixelRatio: 2 }), 2400);
  assert.equal(pagePictureWidth({ cssWidth: 1100, pixelRatio: 1.5 }), 1650);
  assert.equal(pagePictureWidth({ cssWidth: 1333.4, pixelRatio: 2 }), 2667);
});

test("a narrow pane or a 1x screen still gets a picture that needs no tiles on a 1x pane", () => {
  assert.equal(
    pagePictureWidth({ cssWidth: 600, pixelRatio: 1 }),
    MIN_PICTURE_WIDTH,
  );
  assert.equal(
    pagePictureWidth({ cssWidth: 640, pixelRatio: 2 }),
    MIN_PICTURE_WIDTH,
  );
});

test("a very wide pane or screen is held to the memory a page's picture may take", () => {
  assert.equal(
    pagePictureWidth({ cssWidth: 2560, pixelRatio: 2 }),
    MAX_PICTURE_WIDTH,
  );
  assert.equal(
    pagePictureWidth({ cssWidth: 1200, pixelRatio: 3 }),
    MAX_PICTURE_WIDTH,
  );
});

test("a pane that is not measured yet falls back to the narrowest picture", () => {
  assert.equal(
    pagePictureWidth({ cssWidth: 0, pixelRatio: 2 }),
    MIN_PICTURE_WIDTH,
  );
  assert.equal(
    pagePictureWidth({ cssWidth: Number.NaN, pixelRatio: 2 }),
    MIN_PICTURE_WIDTH,
  );
});
