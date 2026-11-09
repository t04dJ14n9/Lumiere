import assert from "node:assert/strict";
import { test } from "node:test";
import { NavigationIntent } from "../../src/shared/navigation-intent";
import { samePosition } from "../../src/shared/pdf-history";
import type { ReadingPosition } from "../../src/shared/reading-position";
import { layoutApplied } from "../../src/webview/stage-layout";
import { readingPlace, zoomChoice } from "../../src/webview/stage-position";
import { loadHook } from "./support/load-hook";

function animationFrames() {
  let next = 0;
  const callbacks = new Map<number, () => void>();
  return {
    globals: {
      requestAnimationFrame: (callback: () => void) => {
        callbacks.set(++next, callback);
        return next;
      },
      cancelAnimationFrame: (id: number) => {
        callbacks.delete(id);
      },
    },
    run(count = 12) {
      for (let i = 0; i < count; i++) {
        const frame = [...callbacks.values()];
        callbacks.clear();
        for (const callback of frame) {
          callback();
        }
      }
    },
  };
}

interface Hook {
  handle(message: Record<string, unknown>): boolean;
  jump(
    run: () => void,
    requestId?: number,
    acceptPreview?: boolean,
    expectedIntent?: number,
  ): void;
  preview(run: () => void): void;
  endPreview(): void;
}

function historyHarness(
  initialZoom: "fitWidth" | "fitPage" = "fitWidth",
  initialFactor = 1,
) {
  const frames = animationFrames();
  const intent = new NavigationIntent();
  const choices = {
    pageLayout: "single",
    scrollMode: "continuous",
    scrollDirection: "vertical",
  } as const;
  let position: ReadingPosition = {
    ...choices,
    page: 3,
    top: 0,
    left: 0,
    zoom: initialZoom,
  };
  // The Stage's zoom, as the viewer reads it: a fit mode, or "custom" at a level.
  let zoomMode = initialZoom === "fitWidth" ? "fit-width" : "fit-page";
  let zoomFactor = initialFactor;
  const messages: Record<string, unknown>[] = [];
  const mutations: string[] = [];
  const stage = {
    getCurrentDestination: () => null,
    listVisiblePages: () => [],
    getSettings: () => ({
      flow: "continuous",
      layout: "vertical",
      spread: "none",
    }),
    getZoomMode: () => zoomMode,
    getZoomLevel: () => zoomFactor,
  };
  const modules = {
    react: {
      useCallback: (callback: unknown) => callback,
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [initial, () => undefined],
      useEffect: () => undefined,
    },
    "../shared/pdf-history": { samePosition },
    "./host": {
      postToHost: (message: Record<string, unknown>) => messages.push(message),
    },
    "./reading-position": {
      rememberedPosition: () => ({ ...position }),
    },
    "./stage-capability": { useStageApi: () => stage },
    "./stage-layout": { layoutApplied },
    "./stage-position": { readingPlace, zoomChoice },
  };
  const hooks = loadHook("jump-history.ts", modules, frames.globals);
  const use = hooks.useJumpHistory as (
    navigation: unknown,
    choices: unknown,
    setChoices: () => void,
  ) => Hook;
  const hook = use(
    {
      intent,
      isReady: () => true,
      pageCount: 10,
      restore: (next: ReadingPosition) => {
        intent.advance(); // The production navigation.restore also supersedes moves in flight.
        mutations.push(`restore:${next.page}`);
        position = { ...next };
        // The restore carries the zoom: a number is a level, a fit mode stays.
        if (typeof next.zoom === "number") {
          zoomMode = "custom";
          zoomFactor = next.zoom / 100;
        } else {
          zoomMode = next.zoom === "fitPage" ? "fit-page" : "fit-width";
        }
      },
    },
    choices,
    () => {
      mutations.push("choices");
    },
  );
  const capture = (): number => {
    hook.handle({ type: "historyCapture", token: 1 });
    return messages.at(-1)!.intent as number;
  };
  const restore = (
    token: number,
    expectedIntent: number,
    zoom: ReadingPosition["zoom"] = "fitWidth",
  ) =>
    hook.handle({
      type: "historyRestore",
      token,
      expectedIntent,
      position: { ...position, page: 1, zoom },
    });
  const setPosition = (next: Partial<ReadingPosition>): void => {
    position = { ...position, ...next };
  };
  return {
    hook,
    frames,
    intent,
    messages,
    mutations,
    capture,
    restore,
    setPosition,
    stage,
  };
}

function jumpPages(messages: Record<string, unknown>[]): number[][] {
  return messages
    .filter((message) => message.type === "historyJump")
    .map((message) => [
      (message.from as ReadingPosition).page,
      (message.to as ReadingPosition).page,
    ]);
}

test("accepting the same search result records the location before its passive preview", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.frames.run();
  assert.equal(jumpPages(harness.messages).length, 0);
  harness.hook.jump(() => harness.setPosition({ page: 8 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[3, 8]]);
});

test("repeated passive previews retain the first origin without recording intermediate stops", () => {
  const harness = historyHarness();
  harness.setPosition({ page: 3, top: 70, left: 12 });
  harness.hook.preview(() => harness.setPosition({ page: 5, top: 20 }));
  harness.hook.preview(() => harness.setPosition({ page: 8, top: 140 }));
  harness.frames.run();
  assert.equal(jumpPages(harness.messages).length, 0);
  harness.hook.jump(
    () => harness.setPosition({ page: 8, top: 140 }),
    undefined,
    true,
  );
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[3, 8]]);
  const from = harness.messages.find(
    (message) => message.type === "historyJump",
  )!.from as ReadingPosition;
  assert.equal(from.top, 70);
  assert.equal(from.left, 12);
});

test("ending a preview prevents a later search action from reusing its old origin", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.hook.endPreview();
  harness.hook.jump(() => harness.setPosition({ page: 9 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[8, 9]]);
});

test("an unrelated jump leaves from the current preview and clears its original source", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.hook.jump(() => harness.setPosition({ page: 6 }));
  harness.frames.run();
  harness.hook.preview(() => harness.setPosition({ page: 9 }));
  harness.hook.jump(() => harness.setPosition({ page: 9 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [
    [8, 6],
    [6, 9],
  ]);
});

test("reader movement retires the preview origin before an explicit result is accepted", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.intent.interrupt();
  harness.setPosition({ page: 6, top: 75 });
  harness.hook.jump(
    () => harness.setPosition({ page: 8, top: 0 }),
    undefined,
    true,
  );
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[6, 8]]);
  const from = harness.messages.find(
    (message) => message.type === "historyJump",
  )!.from as ReadingPosition;
  assert.equal(from.top, 75);
});

test("a new passive preview after reader movement captures the new reading location", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.intent.interrupt();
  harness.setPosition({ page: 6 });
  harness.hook.preview(() => harness.setPosition({ page: 9 }));
  harness.hook.jump(() => harness.setPosition({ page: 9 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[6, 9]]);
});

test("query cancellation tokens and search-control clicks preserve the session origin", () => {
  const harness = historyHarness();
  harness.hook.preview(() => harness.setPosition({ page: 5 }));
  harness.intent.advance(); // Editing a query invalidates its earlier asynchronous results.
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.intent.advance(); // Pointer-down on Next match cancels older viewport work only.
  harness.hook.jump(() => harness.setPosition({ page: 8 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(jumpPages(harness.messages), [[3, 8]]);
});

test("stale restore and timeout messages do not erase a newer search preview origin", () => {
  const harness = historyHarness();
  const stale = harness.intent.current();
  harness.hook.preview(() => harness.setPosition({ page: 8 }));
  harness.restore(99, stale);
  harness.hook.handle({ type: "historyCancel", token: 99 });
  harness.hook.jump(() => harness.setPosition({ page: 8 }), undefined, true);
  harness.frames.run();
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(jumpPages(harness.messages), [[3, 8]]);
});

test("history capture -> user input -> restore IPC rejects stale work before any mutation", () => {
  const harness = historyHarness();
  const captured = harness.capture();
  harness.intent.advance();
  harness.restore(2, captured);
  harness.frames.run();
  assert.deepEqual(harness.mutations, []);
  assert.equal(harness.messages.at(-1)?.ok, false);
  harness.capture();
  assert.equal(harness.messages.at(-1)?.startedToken, 0);
});

test("an uninterrupted replay owns its final restore and acknowledges the actual arrival", () => {
  const harness = historyHarness();
  harness.restore(2, harness.capture());
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices", "restore:1"]);
  assert.equal(harness.messages.at(-1)?.ok, true);
  assert.equal((harness.messages.at(-1)?.position as ReadingPosition).page, 1);
});

for (const [mode, scale, percent] of [
  ["fitWidth", 1, 100],
  ["fitPage", 2, 200],
] as const) {
  test(`history replay changes ${mode} at scale ${scale} to numeric ${percent} in its one move, then acknowledges the arrival`, () => {
    const harness = historyHarness(mode, scale);
    harness.restore(2, harness.capture(), percent);
    harness.frames.run(1);
    assert.deepEqual(harness.mutations, ["choices", "restore:1"]);
    assert.equal(
      harness.messages.some((message) => message.type === "historyRestored"),
      false,
      "not acknowledged until it holds still",
    );
    harness.frames.run();
    assert.deepEqual(harness.mutations, ["choices", "restore:1"]);
    const arrival = harness.messages.at(-1)!;
    assert.equal(arrival.type, "historyRestored");
    assert.equal(arrival.ok, true);
    assert.equal((arrival.position as ReadingPosition).page, 1);
    assert.equal((arrival.position as ReadingPosition).zoom, percent);
  });
}

test("new input before the replay's first frame prevents its position mutation", () => {
  const harness = historyHarness();
  harness.restore(2, harness.capture(), 200);
  harness.intent.advance();
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices"]);
  assert.equal(harness.messages.at(-1)?.ok, false);
  harness.capture();
  assert.equal(harness.messages.at(-1)?.startedToken, 2);
});

test("a replay waits for the Stage to have the replayed layout before it moves", () => {
  const harness = historyHarness();
  let applied = false;
  const settings = harness.stage.getSettings;
  harness.stage.getSettings = () =>
    applied ? settings() : { ...settings(), spread: "odd" };
  harness.restore(2, harness.capture());
  harness.frames.run(5);
  assert.deepEqual(harness.mutations, ["choices"]);
  applied = true;
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices", "restore:1"]);
  assert.equal(harness.messages.at(-1)?.ok, true);
});

test("a token-scoped timeout cancels a replay whose animation frames were paused", () => {
  const harness = historyHarness();
  harness.restore(2, harness.capture());
  harness.hook.handle({ type: "historyCancel", token: 2 });
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices"]);
  assert.equal(harness.messages.at(-1)?.ok, false);
});

test("a late cancellation of an older token cannot cancel the current replay", () => {
  const harness = historyHarness();
  harness.restore(2, harness.capture());
  harness.hook.handle({ type: "historyCancel", token: 999 });
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices", "restore:1"]);
  assert.equal(harness.messages.at(-1)?.ok, true);
});

test("a newer link cancels a queued replay before it can move the viewport", () => {
  const harness = historyHarness();
  harness.restore(2, harness.capture());
  harness.hook.jump(() => {
    harness.mutations.push("new-link");
  });
  harness.frames.run();
  assert.deepEqual(harness.mutations, ["choices", "new-link"]);
  assert.ok(
    harness.messages.some(
      (message) => message.type === "historyRestored" && message.ok === false,
    ),
  );
});

test("native precise delivery rejects reader input between capture and delivery", () => {
  const harness = historyHarness();
  const captured = harness.intent.current();
  harness.intent.advance();
  harness.hook.jump(
    () => harness.mutations.push("stale native jump"),
    801,
    false,
    captured,
  );
  assert.deepEqual(harness.mutations, []);
  assert.equal(harness.messages.at(-1)?.type, "historyRestored");
  assert.equal(harness.messages.at(-1)?.token, 801);
  assert.equal(harness.messages.at(-1)?.ok, false);
});
test("native precise delivery acknowledges settlement and rejects interrupted settlement", () => {
  const harness = historyHarness();
  harness.hook.jump(
    () => harness.setPosition({ page: 9 }),
    802,
    false,
    harness.intent.current(),
  );
  assert.equal(
    harness.messages.some((message) => message.type === "historyRestored"),
    false,
  );
  harness.frames.run();
  assert.equal(harness.messages.at(-1)?.token, 802);
  assert.equal(harness.messages.at(-1)?.ok, true);
  harness.hook.jump(
    () => harness.setPosition({ page: 3 }),
    803,
    false,
    harness.intent.current(),
  );
  harness.intent.advance();
  harness.frames.run();
  assert.equal(harness.messages.at(-1)?.token, 803);
  assert.equal(harness.messages.at(-1)?.ok, false);
});
