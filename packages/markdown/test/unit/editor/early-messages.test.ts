import assert from "node:assert/strict";
import test from "node:test";
import { webviewTransport } from "../../../src/webview/transport";

/** A page whose inline loader (webview-html.ts) kept `queued` before the editor's script ran. */
function pageWith(queued: unknown[]) {
  const target = new EventTarget();
  let stopped = false;
  const fake = Object.assign(target, {
    location: { origin: "vscode-webview://page" },
    lumiereEarlyMessages: {
      queue: queued.map((data) => new MessageEvent("message", { data })),
      stop: () => {
        stopped = true;
      },
    },
  });
  (globalThis as { window?: unknown }).window = fake;
  return { fake, isStopped: () => stopped };
}

test("host messages that came before the editor's listener are delivered first, in order", () => {
  const { fake, isStopped } = pageWith(["first", "second"]);
  const received: unknown[] = [];
  const stop = webviewTransport({ postMessage() {} }).listen((message) =>
    received.push(message),
  );
  assert.deepEqual(received, ["first", "second"]);
  assert.equal(isStopped(), true, "the loader stops keeping messages");
  fake.dispatchEvent(new MessageEvent("message", { data: "third" }));
  assert.deepEqual(received, ["first", "second", "third"]);
  stop();
  fake.dispatchEvent(new MessageEvent("message", { data: "fourth" }));
  assert.equal(received.length, 3);
});

test("a page without the inline loader just listens", () => {
  const fake = Object.assign(new EventTarget(), {
    location: { origin: "vscode-webview://page" },
  });
  (globalThis as { window?: unknown }).window = fake;
  const received: unknown[] = [];
  webviewTransport({ postMessage() {} }).listen((message) =>
    received.push(message),
  );
  fake.dispatchEvent(new MessageEvent("message", { data: "only" }));
  assert.deepEqual(received, ["only"]);
});
