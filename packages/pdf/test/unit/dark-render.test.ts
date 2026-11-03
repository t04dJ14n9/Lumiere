import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageDataLike } from "@embedpdf/models";
import { DARK_PALETTE, FORCED_PAGE_COLORS } from "../../src/shared/dark-page";
import {
  darkPageRender,
  type RawRenderTask,
} from "../../src/webview/dark-render";

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Raw renders the test finishes by hand. */
function harness() {
  const renders: {
    options: Record<string, unknown>;
    done: (image: ImageDataLike) => void;
    fail: (error: unknown) => void;
    aborted: boolean;
  }[] = [];
  const render = (options: Record<string, unknown>): RawRenderTask => {
    const record = {
      options,
      aborted: false,
      done: (_image: ImageDataLike): void => undefined,
      fail: (_error: unknown): void => undefined,
    };
    const result = new Promise<ImageDataLike>((resolve, reject) => {
      record.done = resolve;
      record.fail = reject;
    });
    renders.push(record);
    return {
      toPromise: () => result,
      abort() {
        record.aborted = true;
      },
    };
  };
  return { render, renders };
}

const image = (alpha: number): ImageDataLike => ({
  data: Uint8ClampedArray.from([255, 255, 255, 255]).map((value, at) =>
    at === 3 ? alpha : value,
  ),
  width: 1,
  height: 1,
});

test("a dark page asks for the page as authored and once more with the forced colours", () => {
  const { render, renders } = harness();
  darkPageRender(render, { scaleFactor: 1.5, dpr: 2 }, async () => new Blob());
  assert.deepEqual(renders[0]!.options, { scaleFactor: 1.5, dpr: 2 });
  assert.deepEqual(renders[1]!.options, {
    scaleFactor: 1.5,
    dpr: 2,
    pageColors: FORCED_PAGE_COLORS,
  });
});

test("when both renders are in, the first is darkened and encoded", async () => {
  const { render, renders } = harness();
  const blob = new Blob(["page"]);
  const encoded: ImageDataLike[] = [];
  const task = darkPageRender(
    render,
    { scaleFactor: 1, dpr: 1 },
    async (page) => {
      encoded.push(page);
      return blob;
    },
  );
  const ready: unknown[] = [];
  task.wait(
    (result) => ready.push(result),
    () => assert.fail("no error expected"),
  );
  renders[0]!.done(image(255));
  renders[1]!.done(image(0));
  await later();
  assert.deepEqual(ready, [blob]);
  assert.deepEqual(
    [...encoded[0]!.data],
    [...DARK_PALETTE.background, 255],
    "the white paper is the dark paper",
  );
});

test("giving the page up stops both renders and reports nothing", async () => {
  const { render, renders } = harness();
  let encodes = 0;
  const task = darkPageRender(render, { scaleFactor: 1, dpr: 1 }, async () => {
    encodes++;
    return new Blob();
  });
  const heard: unknown[] = [];
  task.wait(
    (result) => heard.push(result),
    (error) => heard.push(error),
  );
  task.abort({ code: 2, message: "canceled" });
  assert.deepEqual(
    renders.map((record) => record.aborted),
    [true, true],
  );
  renders[0]!.fail({ code: 2 });
  renders[1]!.done(image(0));
  await later();
  assert.deepEqual(heard, []);
  assert.equal(encodes, 0);
});

test("a render that fails is reported once and the other is stopped", async () => {
  const { render, renders } = harness();
  const task = darkPageRender(render, { scaleFactor: 1, dpr: 1 }, async () => {
    throw new Error("not reached");
  });
  const errors: unknown[] = [];
  task.wait(
    () => assert.fail("not ready"),
    (error) => errors.push(error),
  );
  const failure = new Error("PDFium failed");
  renders[1]!.fail(failure);
  await later();
  assert.deepEqual(errors, [failure]);
  assert.equal(renders[0]!.aborted, true);
});

test("a page that cannot be encoded is reported as an error", async () => {
  const { render, renders } = harness();
  const failure = new Error("no canvas");
  const task = darkPageRender(render, { scaleFactor: 1, dpr: 1 }, async () => {
    throw failure;
  });
  const errors: unknown[] = [];
  task.wait(
    () => assert.fail("not ready"),
    (error) => errors.push(error),
  );
  renders[0]!.done(image(255));
  renders[1]!.done(image(0));
  await later();
  assert.deepEqual(errors, [failure]);
});
