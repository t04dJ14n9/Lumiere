import test from "node:test";
import assert from "node:assert/strict";
import { findActionFor, keepFindKey, type FindKey } from "./find-keys";

const key = (overrides: Partial<FindKey> = {}): FindKey => ({
  key: "f",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

test("Ctrl/Cmd+F is Find; Ctrl/Cmd+H (and Cmd+Option+F on macOS) is Replace; other chords are not", () => {
  for (const isMac of [false, true]) {
    const modifier = { ctrlKey: !isMac, metaKey: isMac };
    assert.equal(findActionFor(key({ ...modifier }), isMac), "find");
    assert.equal(findActionFor(key({ ...modifier, key: "F" }), isMac), "find");
    assert.equal(
      findActionFor(key({ ...modifier, key: "а", keyCode: 70 }), isMac),
      "find",
    );
    assert.equal(
      findActionFor(key({ ...modifier, key: "h" }), isMac),
      "replace",
    );
    assert.equal(
      findActionFor(key({ ...modifier, key: "H" }), isMac),
      "replace",
    );
    assert.equal(
      findActionFor(key({ ...modifier, key: "а", keyCode: 72 }), isMac),
      "replace",
    );
    // Mod+Alt+F is Replace on macOS only (Obsidian's and VS Code's key
    // there); Mod+Alt+H is nothing anywhere.
    assert.equal(
      findActionFor(key({ ...modifier, altKey: true }), isMac),
      isMac ? "replace" : undefined,
    );
    assert.equal(
      findActionFor(
        key({ ...modifier, altKey: true, key: "ƒ", keyCode: 70 }),
        isMac,
      ),
      isMac ? "replace" : undefined,
    );
    for (const override of [
      { altKey: true, key: "h" },
      { altKey: true, shiftKey: true },
      { shiftKey: true },
      { ctrlKey: true, metaKey: true },
      { ctrlKey: false, metaKey: false },
      { key: "s" },
      { key: "e" },
      { key: "а", keyCode: 69 },
    ]) {
      assert.equal(
        findActionFor(key({ ...modifier, ...override }), isMac),
        undefined,
      );
    }
    assert.equal(
      findActionFor(key({ ctrlKey: isMac, metaKey: !isMac }), isMac),
      undefined,
    );
  }
});

test("capture listener owns Mod+F/H and skips native fields", () => {
  const calls: string[] = [];
  const listeners = new Map<string, EventListener>();
  const doc = {
    defaultView: { navigator: { platform: "Linux x86_64" } },
    addEventListener(type: string, listener: EventListener, opts?: unknown) {
      assert.equal(type, "keydown");
      assert.equal(opts, true);
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: EventListener, opts?: unknown) {
      assert.equal(opts, true);
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
  } as unknown as Document;

  const stop = keepFindKey(
    doc,
    (replace) => {
      calls.push(replace ? "replace" : "find");
    },
    (target) =>
      Boolean(
        target &&
        typeof target === "object" &&
        "tagName" in target &&
        String((target as { tagName?: string }).tagName).toUpperCase() ===
          "INPUT",
      ),
  );

  const listener = listeners.get("keydown");
  assert.ok(listener);

  const fire = (init: Partial<KeyboardEvent> & { target?: EventTarget }) => {
    let prevented = false;
    const event = {
      key: "f",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null as EventTarget | null,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      ...init,
    };
    listener!(event as unknown as Event);
    return { prevented };
  };

  assert.equal(fire({}).prevented, true);
  assert.deepEqual(calls, ["find"]);

  calls.length = 0;
  assert.equal(fire({ key: "h" }).prevented, true);
  assert.deepEqual(calls, ["replace"]);

  calls.length = 0;
  assert.equal(
    fire({ target: { tagName: "INPUT" } as unknown as EventTarget }).prevented,
    false,
  );
  assert.deepEqual(calls, []);

  stop();
  assert.equal(listeners.size, 0);
});

test("missing document is a no-op dispose", () => {
  const stop = keepFindKey(undefined as unknown as Document, () => {
    assert.fail("must not open find without a document");
  });
  stop();
});

test("Vim INSERT Mod+H deletes char instead of opening Replace (BH-045)", () => {
  const calls: string[] = [];
  const listeners = new Map<string, EventListener>();
  const doc = {
    defaultView: { navigator: { platform: "Linux x86_64" } },
    addEventListener(type: string, listener: EventListener, opts?: unknown) {
      assert.equal(opts, true);
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: EventListener, opts?: unknown) {
      assert.equal(opts, true);
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
  } as unknown as Document;

  let insert = true;
  keepFindKey(
    doc,
    (replace) => {
      calls.push(replace ? "replace" : "find");
    },
    () => false,
    {
      isInsertMode: () => insert,
      onInsertCtrlH: () => {
        calls.push("insert-c-h");
      },
    },
  );

  const listener = listeners.get("keydown")!;
  const fire = (key: string) => {
    const event = {
      key,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault() {},
      stopPropagation() {},
    };
    listener(event as unknown as Event);
  };

  fire("h");
  assert.deepEqual(calls, ["insert-c-h"]);

  insert = false;
  calls.length = 0;
  fire("h");
  assert.deepEqual(calls, ["replace"]);

  calls.length = 0;
  fire("f");
  assert.deepEqual(calls, ["find"]);
});

/**
 * A capture listener on a fake Document of the given platform, with Vim INSERT
 * switched by `state.insert`. `fire` returns whether the key was claimed
 * (preventDefault) and `calls` lists what ran, in order.
 */
function captureHarness(platform: string, insert: boolean) {
  const calls: string[] = [];
  const state = { insert };
  let listener: EventListener | undefined;
  const doc = {
    defaultView: { navigator: { platform } },
    addEventListener(_type: string, handler: EventListener) {
      listener = handler;
    },
    removeEventListener() {},
  } as unknown as Document;
  keepFindKey(
    doc,
    (replace) => {
      calls.push(replace ? "replace" : "find");
    },
    undefined,
    {
      isInsertMode: () => state.insert,
      onInsertCtrlH: () => {
        calls.push("delete-backward");
      },
    },
  );
  const fire = (init: Partial<KeyboardEvent> & { target?: unknown }) => {
    let prevented = false;
    listener!({
      key: "f",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      ...init,
    } as unknown as Event);
    return prevented;
  };
  return { calls, state, fire };
}

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

test("Vim INSERT: macOS Cmd+Option+F opens Replace and deletes nothing (#817)", () => {
  const { calls, fire } = captureHarness(MAC, true);

  // Option+F types ƒ, so a real keydown carries key "ƒ" and keyCode 70.
  assert.equal(
    fire({ key: "ƒ", keyCode: 70, metaKey: true, altKey: true }),
    true,
  );
  assert.deepEqual(calls, ["replace"]);

  calls.length = 0;
  assert.equal(fire({ key: "f", metaKey: true, altKey: true }), true);
  assert.deepEqual(calls, ["replace"]);

  // A non-Latin layout reaches F only through its physical keyCode.
  calls.length = 0;
  assert.equal(
    fire({ key: "а", keyCode: 70, metaKey: true, altKey: true }),
    true,
  );
  assert.deepEqual(calls, ["replace"]);
});

test("Vim INSERT: Ctrl+H on Windows and Linux still deletes backward (BH-045)", () => {
  const { calls, fire } = captureHarness(LINUX, true);

  assert.equal(fire({ key: "h", ctrlKey: true }), true);
  assert.deepEqual(calls, ["delete-backward"]);

  calls.length = 0;
  assert.equal(fire({ key: "H", ctrlKey: true }), true);
  assert.deepEqual(calls, ["delete-backward"]);

  // A non-Latin layout reaches H only through its physical keyCode.
  calls.length = 0;
  assert.equal(fire({ key: "р", keyCode: 72, ctrlKey: true }), true);
  assert.deepEqual(calls, ["delete-backward"]);

  // Ctrl+F stays Find in INSERT.
  calls.length = 0;
  assert.equal(fire({ key: "f", ctrlKey: true }), true);
  assert.deepEqual(calls, ["find"]);
});

test("Vim INSERT: only the Ctrl+H chord deletes; Cmd+H on macOS opens Replace (#817)", () => {
  const { calls, fire } = captureHarness(MAC, true);

  // Cmd+H is not Ctrl+H, and on macOS Ctrl+H is left to the editor's own
  // keymap (the capture does not claim it).
  assert.equal(fire({ key: "h", metaKey: true }), true);
  assert.deepEqual(calls, ["replace"]);

  calls.length = 0;
  assert.equal(fire({ key: "h", ctrlKey: true }), false);
  assert.deepEqual(calls, []);
});

test("outside Vim INSERT the Replace chords open Replace (#817)", () => {
  const linux = captureHarness(LINUX, false);
  assert.equal(linux.fire({ key: "h", ctrlKey: true }), true);
  assert.deepEqual(linux.calls, ["replace"]);

  const mac = captureHarness(MAC, false);
  assert.equal(mac.fire({ key: "h", metaKey: true }), true);
  assert.equal(
    mac.fire({ key: "ƒ", keyCode: 70, metaKey: true, altKey: true }),
    true,
  );
  assert.equal(mac.fire({ key: "f", metaKey: true, altKey: true }), true);
  assert.deepEqual(mac.calls, ["replace", "replace", "replace"]);
});

test("native INPUT and TEXTAREA keep Ctrl+H and Cmd+Option+F, in INSERT too (#817)", () => {
  for (const tagName of ["INPUT", "TEXTAREA"]) {
    const target = { tagName } as unknown as EventTarget;
    const mac = captureHarness(MAC, true);
    assert.equal(
      mac.fire({
        key: "ƒ",
        keyCode: 70,
        metaKey: true,
        altKey: true,
        target,
      }),
      false,
    );
    assert.deepEqual(mac.calls, []);

    const linux = captureHarness(LINUX, true);
    assert.equal(linux.fire({ key: "h", ctrlKey: true, target }), false);
    assert.deepEqual(linux.calls, []);
  }
});
