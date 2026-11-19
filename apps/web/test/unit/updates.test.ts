// A new build waits for the reader instead of taking over a running window,
// whose editor pages would then come from another build.
import test from "node:test";
import assert from "node:assert/strict";
import { isTakeOver, TAKE_OVER } from "../../src/shared/messages";
import { offerUpdates, type UpdateParts } from "../../src/updates";

function events() {
  const listeners = new Map<string, (() => void)[]>();
  return {
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    fire: (type: string) => listeners.get(type)?.forEach((call) => call()),
  };
}

function app(options: { controlled: boolean; waiting?: boolean }) {
  const posted: unknown[] = [];
  const worker = { postMessage: (message: unknown) => posted.push(message) };
  const installing = { state: "installing", ...events() };
  const registration = {
    waiting: options.waiting ? worker : null,
    installing: null as typeof installing | null,
    ...events(),
  };
  const workers = {
    controller: options.controlled ? {} : null,
    ...events(),
  };
  const offers: (() => void)[] = [];
  const log: string[] = [];
  const parts: UpdateParts = {
    registration,
    workers,
    offer: (accept) => offers.push(accept),
    saveAll: async () => {
      log.push("save");
    },
    reload: () => log.push("reload"),
  };
  /** The browser found a new build, and it finished installing. */
  const install = () => {
    registration.installing = installing;
    registration.fire("updatefound");
    installing.state = "installed";
    registration.waiting = worker;
    installing.fire("statechange");
  };
  return { parts, posted, offers, log, workers, install };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a new build that installs under a running window is offered, not swapped in", async () => {
  const { parts, posted, offers, log, workers, install } = app({
    controlled: true,
  });
  offerUpdates(parts);
  install();
  assert.equal(offers.length, 1);
  assert.deepEqual(posted, [], "the worker waits until the reader says yes");

  offers[0]!();
  assert.deepEqual(posted, [TAKE_OVER]);
  workers.fire("controllerchange");
  await settle();
  assert.deepEqual(log, ["save", "reload"]);
});

test("a build already waiting when the window starts is offered", () => {
  const { parts, offers } = app({ controlled: true, waiting: true });
  offerUpdates(parts);
  assert.equal(offers.length, 1);
});

test("the first worker takes over a window that had none without a reload", async () => {
  const { parts, offers, log, workers } = app({ controlled: false });
  offerUpdates(parts);
  workers.controller = {};
  workers.fire("controllerchange");
  await settle();
  assert.deepEqual(offers, []);
  assert.deepEqual(log, []);

  // A later build, taken over at another window's yes, reloads this one too.
  workers.fire("controllerchange");
  await settle();
  assert.deepEqual(log, ["save", "reload"]);
});

test("only a take-over message makes the worker take over", () => {
  assert.equal(isTakeOver(TAKE_OVER), true);
  assert.equal(isTakeOver({ lumiere: "page", id: "1" }), false);
  assert.equal(isTakeOver("take-over"), false);
});
