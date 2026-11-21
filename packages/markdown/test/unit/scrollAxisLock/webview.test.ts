import assert from "node:assert/strict";
import test from "node:test";
import { readSettings } from "../../../src/host/settings";
import { features } from "../../../src/plugins/catalog";
import { fixture } from "../features/fixture";

const reader = (values: Record<string, unknown>) => ({
  get: <T>(key: string, fallback?: T) => (values[key] ?? fallback) as T,
});

test("axis-locked scrolling is on by default and follows editor.scrollPredominantAxis", () => {
  assert.equal(
    features.find(({ id }) => id === "scrollAxisLock")?.defaultEnabled,
    true,
  );
  assert.deepEqual(
    readSettings(reader({}), reader({})).features?.scrollAxisLock,
    {
      enabled: true,
      config: { predominantAxis: true },
    },
  );
  const off = readSettings(
    reader({}),
    reader({ "editor.scrollPredominantAxis": false }),
  );
  assert.deepEqual(off.features?.scrollAxisLock?.config, {
    predominantAxis: false,
  });
  assert.equal(
    readSettings(
      reader({ "plugins.scrollAxisLock.enabled": false }),
      reader({}),
    ).features?.scrollAxisLock?.enabled,
    false,
  );
});

let time = 10_000;

/** A wheel in a new gesture: the first the browser had, then one the page can cancel. */
function swipe(target: EventTarget, options: { cancelable: boolean }): Event {
  const event = new Event("wheel", { cancelable: options.cancelable });
  time += 400;
  Object.defineProperties(event, {
    timeStamp: { value: time },
    deltaX: { value: 3 },
    deltaY: { value: 40 },
    deltaMode: { value: 0 },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
  return event;
}

test("the editor's wheels are taken while the plugin and the setting are on, and left alone otherwise", async (t) => {
  const f = fixture();
  const moves: unknown[] = [];
  Object.assign(f.view.scrollDOM, {
    parentElement: null,
    clientWidth: 800,
    clientHeight: 600,
    scrollWidth: 800,
    scrollHeight: 9000,
    scrollLeft: 0,
    scrollTop: 0,
    scrollBy: (options: unknown) => moves.push(options),
  });
  const global = globalThis as {
    getComputedStyle?: unknown;
    requestAnimationFrame?: unknown;
  };
  const saved = [global.getComputedStyle, global.requestAnimationFrame];
  global.getComputedStyle = () => ({ overflowX: "auto", overflowY: "auto" });
  global.requestAnimationFrame = () => 0;
  t.after(async () => {
    [global.getComputedStyle, global.requestAnimationFrame] = saved;
    await f.root.dispose();
  });
  // The wheels of one gesture: the browser had the first, the page cancels the rest.
  const gesture = () => {
    swipe(f.view.dom, { cancelable: false });
    return swipe(f.view.dom, { cancelable: true });
  };
  const on = {
    scrollAxisLock: { enabled: true, config: { predominantAxis: true } },
  };
  await f.configure(on);
  assert.equal(gesture().defaultPrevented, true);
  assert.deepEqual(moves, [{ top: 40, behavior: "instant" }]);

  await f.configure({
    scrollAxisLock: { enabled: true, config: { predominantAxis: false } },
  });
  assert.equal(gesture().defaultPrevented, false, "the setting off");
  await f.configure(on);
  assert.equal(gesture().defaultPrevented, true, "the setting back on");
  await f.configure({});
  assert.equal(gesture().defaultPrevented, false, "the plugin off");
  assert.equal(moves.length, 2);
});
