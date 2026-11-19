import assert from "node:assert/strict";
import test from "node:test";
import { saveOnHide, type HidingWindow } from "../../src/save-on-hide";

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, listener: () => void) => {
    const set = listeners.get(type) ?? new Set();
    set.add(listener);
    listeners.set(type, set);
  };
  const off = (type: string, listener: () => void) =>
    listeners.get(type)?.delete(listener);
  const page = {
    document: {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: on,
      removeEventListener: off,
    },
    addEventListener: on,
    removeEventListener: off,
  };
  const fire = (type: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener();
    }
  };
  return { page: page as HidingWindow & typeof page, fire };
}

test("unsaved notes are written when the window is hidden or goes, not when it shows", () => {
  const { page, fire } = fakeWindow();
  let saves = 0;
  const stop = saveOnHide(async () => {
    saves += 1;
  }, page);

  page.document.visibilityState = "hidden";
  fire("visibilitychange");
  assert.equal(saves, 1);
  page.document.visibilityState = "visible";
  fire("visibilitychange");
  assert.equal(saves, 1);
  fire("pagehide");
  assert.equal(saves, 2);

  stop();
  fire("pagehide");
  assert.equal(saves, 2);
});

test("a save that fails when the window hides is reported", async () => {
  const { page, fire } = fakeWindow();
  const reported: unknown[] = [];
  saveOnHide(
    () => Promise.reject(new Error("Disk full")),
    page,
    (error) => reported.push(error),
  );
  fire("pagehide");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(String(reported[0]), /Disk full/);
});
