import assert from "node:assert/strict";
import { test } from "node:test";
import { RecentCache } from "../../src/shared/recent-cache";
import { ThumbnailImages } from "../../src/webview/side-panel/thumbnail-images";

/** A render plugin whose pictures arrive when the test says. */
function fakeRender() {
  const requests: {
    page: number;
    width: number;
    rotation: number | undefined;
    signal: AbortSignal;
    finish: () => void;
    fail: (error: Error) => void;
  }[] = [];
  const revoked: string[] = [];
  const render = {
    renderPage: (
      page: number,
      options: { width: number; rotation?: number; signal: AbortSignal },
    ) =>
      new Promise((resolve, reject) => {
        const request = {
          page,
          width: options.width,
          rotation: options.rotation,
          signal: options.signal,
          finish: () =>
            resolve({
              objectUrl: async () => ({
                url: `blob:page-${page}-${options.width}`,
                revoke: () =>
                  revoked.push(`blob:page-${page}-${options.width}`),
              }),
            }),
          fail: reject,
        };
        options.signal.addEventListener("abort", () =>
          reject(new Error("cancelled")),
        );
        requests.push(request);
      }),
    onInvalidated: () => () => undefined,
  };
  return { render, requests, revoked };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function open(rotationOf: (page: number) => 0 | 90 | 180 | 270 = () => 0) {
  const fake = fakeRender();
  let changes = 0;
  const images = new ThumbnailImages(
    fake.render as never,
    () => {
      changes++;
    },
    rotationOf,
  );
  return { ...fake, images, changes: () => changes };
}

test("only the pages asked for are drawn, two at a time, nearest the reader first", async () => {
  const h = open();
  h.images.want([5, 4, 6, 3, 7], 160);
  assert.deepEqual(
    h.requests.map((request) => request.page),
    [5, 4],
  );
  h.requests[0]!.finish();
  await settle();
  assert.deepEqual(
    h.requests.map((request) => request.page),
    [5, 4, 6],
  );
  assert.equal(h.images.urlOf(5, 160), "blob:page-5-160");
  assert.equal(h.images.urlOf(4, 160), undefined);
  assert.equal(h.changes(), 1);
  h.images.dispose();
});

test("a page that scrolled away before it was drawn is cancelled and never shows", async () => {
  const h = open();
  h.images.want([0, 1], 160);
  h.images.want([1, 2], 160);
  assert.equal(h.requests[0]!.signal.aborted, true);
  assert.equal(h.requests[1]!.signal.aborted, false);
  await settle();
  // The freed place went to the next page, and page 0 is not drawn later.
  assert.deepEqual(
    h.requests.map((request) => request.page),
    [0, 1, 2],
  );
  h.requests[0]!.finish();
  await settle();
  assert.equal(h.images.urlOf(0, 160), undefined);
  h.images.dispose();
});

test("a picture once drawn is kept, and asked for again only at another width", async () => {
  const h = open();
  h.images.want([2], 160);
  h.requests[0]!.finish();
  await settle();
  h.images.want([2], 160);
  assert.equal(h.requests.length, 1);
  h.images.want([2], 176);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.width, 176);
  h.images.dispose();
});

test("a page that cannot be drawn is not tried again until the pixels change", async () => {
  const h = open();
  h.images.want([3], 160);
  h.requests[0]!.fail(new Error("PDFium said no"));
  await settle();
  h.images.want([3], 160);
  assert.equal(h.requests.length, 1);
  h.images.invalidate();
  assert.equal(h.requests.length, 2);
  h.images.dispose();
});

test("a change of the pages' pixels drops every picture, lets their urls go, and draws the pages in view again", async () => {
  const h = open();
  h.images.want([0], 160);
  h.requests[0]!.finish();
  await settle();
  h.images.invalidate();
  assert.deepEqual(h.revoked, ["blob:page-0-160"]);
  assert.equal(h.images.urlOf(0, 160), undefined);
  assert.equal(h.requests.length, 2);
  h.images.dispose();
});

test("the pictures kept are limited, and each one dropped for room lets its url go", async () => {
  const h = open();
  for (let page = 0; page < 205; page++) {
    h.images.want([page], 160);
    h.requests.at(-1)!.finish();
    await settle();
  }
  assert.equal(h.images.urlOf(204, 160), "blob:page-204-160");
  assert.equal(h.images.urlOf(0, 160), undefined);
  assert.equal(h.revoked.length, 5);
  h.images.dispose();
  assert.equal(h.revoked.length, 205);
});

test("a picture that arrives after the panel is gone is let go at once", async () => {
  const h = open();
  h.images.want([0], 160);
  h.images.dispose();
  h.requests[0]!.finish();
  await settle();
  assert.deepEqual(h.revoked, []);
});

test("the recent cache tells what it drops for room, and what clear drops", () => {
  const dropped: string[] = [];
  const cache = new RecentCache<string, number>(2, (key) => dropped.push(key));
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.deepEqual(dropped, ["b"]);
  cache.clear();
  assert.deepEqual(dropped, ["b", "a", "c"]);
  assert.equal(cache.size, 0);
});

test("a page turned on screen is drawn turned, as wide as asked, and one that is not is drawn as stored", () => {
  const turns = [0, 90, 180, 270] as const;
  const h = open((page) => turns[page] ?? 0);
  h.images.want([0, 1], 160);
  assert.deepEqual(
    h.requests.map((request) => [
      request.page,
      request.rotation,
      request.width,
    ]),
    [
      [0, 0, 160],
      [1, 90, 160],
    ],
  );
  h.requests[0]!.finish();
  h.requests[1]!.finish();
  h.images.dispose();
});
