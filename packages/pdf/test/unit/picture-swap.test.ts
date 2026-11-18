import assert from "node:assert/strict";
import { test } from "node:test";
import { swapWhenDecoded } from "../../src/shared/picture-swap";

/** A slot that records what it showed, and decodes that finish when told to. */
function harness(hasPicture: boolean) {
  const shown: string[] = [];
  const pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  const slot = {
    hasPicture: () => hasPicture || shown.length > 0,
    show: (url: string) => {
      shown.push(url);
    },
  };
  const give = swapWhenDecoded(
    slot,
    (url) =>
      new Promise<void>((resolve, reject) => {
        pending.set(url, { resolve, reject });
      }),
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { shown, pending, give, settle };
}

test("a page's first picture is shown at once: there is nothing to keep", () => {
  const { shown, pending, give } = harness(false);
  give("blob:first");
  assert.deepEqual(shown, ["blob:first"]);
  assert.equal(pending.size, 0);
});

test("a page that has a picture keeps it until the next one is decoded", async () => {
  const { shown, pending, give, settle } = harness(true);
  give("blob:sharper");
  await settle();
  assert.deepEqual(shown, [], "the old picture stays while decoding");
  pending.get("blob:sharper")!.resolve();
  await settle();
  assert.deepEqual(shown, ["blob:sharper"]);
});

test("of pictures given while one decodes, only the last is shown", async () => {
  const { shown, pending, give, settle } = harness(true);
  give("blob:a");
  give("blob:b");
  give("blob:c");
  pending.get("blob:c")!.resolve();
  pending.get("blob:a")!.resolve();
  pending.get("blob:b")!.resolve();
  await settle();
  assert.deepEqual(shown, ["blob:c"]);
});

test("a picture replaced before it decoded is not shown when its decode fails", async () => {
  const { shown, pending, give, settle } = harness(true);
  give("blob:revoked");
  give("blob:current");
  pending.get("blob:revoked")!.reject(new Error("EncodingError"));
  await settle();
  assert.deepEqual(shown, []);
  pending.get("blob:current")!.resolve();
  await settle();
  assert.deepEqual(shown, ["blob:current"]);
});

test("the latest picture is shown even when it cannot be decoded, so its failure is seen", async () => {
  const { shown, pending, give, settle } = harness(true);
  give("blob:broken");
  pending.get("blob:broken")!.reject(new Error("EncodingError"));
  await settle();
  assert.deepEqual(shown, ["blob:broken"]);
});
