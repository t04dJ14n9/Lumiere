import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutlineFocus,
  LEAVE_RESTORE_MS,
  NATIVE_OUTLINE_ID,
  PDF_LUMIERE_EDITOR,
  TAGS_VIEW_ID,
} from "../../../src/plugins/outline/focus";
import { VIEW_ID } from "../../../src/plugins/outline/commands";

test("entering a Lumiere editor runs no view command until Markdown Outline is on screen", async () => {
  const executed: string[] = [];
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    isOutlineShown: () => false,
    schedule: () => ({ dispose() {} }),
  });
  focus.sync(true);
  await settle();
  // Focusing a view reveals its container: from Search or Quick Open that
  // would swap the Search view for the Explorer.
  assert.deepEqual(executed, [], "the sidebar container is left as it is");
  focus.dispose();
  await settle();
});

test("Markdown Outline appearing replaces the native Outline once, without focusing a view", async () => {
  const executed: string[] = [];
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    isOutlineShown: () => false,
    schedule: () => ({ dispose() {} }),
  });
  focus.sync(true);
  focus.outlineShown();
  await settle();
  assert.deepEqual(executed, [`${NATIVE_OUTLINE_ID}.removeView`]);
  assert.ok(
    !executed.includes(`${VIEW_ID}.focus`),
    "Markdown Outline shows itself; focusing it would bring up the Explorer",
  );
  assert.ok(
    !executed.includes(`${TAGS_VIEW_ID}.focus`),
    "Tags must stay collapsed: do not call tags.focus on enter",
  );
  executed.length = 0;
  focus.outlineShown();
  focus.sync(true);
  await settle();
  assert.deepEqual(
    executed,
    [],
    "shown again or re-entered while engaged is a no-op",
  );
  focus.dispose();
  await settle();
});

test("an editor activated under an Outline already on screen hides the native Outline at once", async () => {
  const executed: string[] = [];
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    isOutlineShown: () => true,
    schedule: () => ({ dispose() {} }),
  });
  focus.sync(true);
  await settle();
  assert.deepEqual(executed, [`${NATIVE_OUTLINE_ID}.removeView`]);
  focus.dispose();
  await settle();
});

test("Markdown Outline appearing with no Lumiere editor active hides nothing", async () => {
  const executed: string[] = [];
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    schedule: () => ({ dispose() {} }),
  });
  focus.outlineShown();
  await settle();
  assert.deepEqual(executed, []);
  focus.dispose();
  await settle();
});

test("leaving restores native Outline after the debounce window", async () => {
  const executed: string[] = [];
  let pending: (() => void) | undefined;
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => undefined,
    leaveDelayMs: LEAVE_RESTORE_MS,
    schedule: (run) => {
      pending = run;
      return {
        dispose() {
          pending = undefined;
        },
      };
    },
  });
  focus.sync(true);
  focus.outlineShown();
  await settle();
  executed.length = 0;
  focus.sync(false);
  assert.equal(typeof pending, "function");
  assert.deepEqual(executed, [], "restore waits for the debounce");
  pending!();
  await settle();
  assert.deepEqual(executed, [`${NATIVE_OUTLINE_ID}.focus`, "focusEditor"]);
  focus.dispose();
  await settle();
});

test("leaving restores nothing when the native Outline was never hidden", async () => {
  const executed: string[] = [];
  let pending: (() => void) | undefined;
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => undefined,
    schedule: (run) => {
      pending = run;
      return {
        dispose() {
          pending = undefined;
        },
      };
    },
  });
  // Search was showing the whole time: Markdown Outline never appeared.
  focus.sync(true);
  await settle();
  focus.sync(false);
  pending!();
  await settle();
  // Restoring means focusing the native Outline, which would bring up the
  // Explorer for an Outline that is still where it was.
  assert.deepEqual(executed, []);
  focus.dispose();
  await settle();
});

test("the native Outline is restored once per hiding", async () => {
  const executed: string[] = [];
  let pending: (() => void) | undefined;
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => undefined,
    schedule: (run) => {
      pending = run;
      return { dispose() {} };
    },
  });
  focus.sync(true);
  focus.outlineShown();
  focus.sync(false);
  pending!();
  await settle();
  executed.length = 0;
  focus.dispose();
  await settle();
  assert.deepEqual(executed, [], "already restored on leave");
  focus.sync(true);
  focus.sync(false);
  pending!();
  await settle();
  assert.deepEqual(executed, [], "no second restore without a second hiding");
});

test("a quick re-enter cancels the pending native Outline restore", async () => {
  const executed: string[] = [];
  let pending: (() => void) | undefined;
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    schedule: (run) => {
      pending = run;
      return {
        dispose() {
          pending = undefined;
        },
      };
    },
  });
  focus.sync(true);
  await settle();
  executed.length = 0;
  focus.sync(false);
  focus.sync(true);
  assert.equal(pending, undefined, "leave timer cleared on re-enter");
  await settle();
  assert.deepEqual(
    executed,
    [],
    "still engaged: no second enter and no restore",
  );
  focus.dispose();
  await settle();
});

test("leave after peer Lumiere is active does not restore native Outline", async () => {
  const executed: string[] = [];
  let pending: (() => void) | undefined;
  const active = { viewType: undefined as string | undefined };
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => active.viewType,
    schedule: (run) => {
      pending = run;
      return {
        dispose() {
          pending = undefined;
        },
      };
    },
  });
  focus.sync(true);
  focus.outlineShown();
  await settle();
  executed.length = 0;
  focus.sync(false);
  // Peer Lumiere PDF took the tab before the debounce fired.
  active.viewType = PDF_LUMIERE_EDITOR;
  pending!();
  await settle();
  assert.deepEqual(
    executed,
    [],
    "handoff: peer owns the sidebar so leave must not call outline.focus",
  );
  focus.dispose();
  await settle();
});

test("dispose restores native Outline unless a peer Lumiere owns the tab", async () => {
  const executed: string[] = [];
  const active = { viewType: undefined as string | undefined };
  const focus = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => active.viewType,
    schedule: () => ({ dispose() {} }),
  });
  focus.sync(true);
  focus.outlineShown();
  await settle();
  executed.length = 0;
  focus.dispose();
  await settle();
  assert.deepEqual(executed, [`${NATIVE_OUTLINE_ID}.focus`]);

  const peer = createOutlineFocus({
    execute: async (command) => {
      executed.push(command);
    },
    focusEditor: async () => {
      executed.push("focusEditor");
    },
    activeCustomEditorViewType: () => active.viewType,
    schedule: () => ({ dispose() {} }),
  });
  peer.sync(true);
  peer.outlineShown();
  await settle();
  executed.length = 0;
  active.viewType = PDF_LUMIERE_EDITOR;
  peer.dispose();
  await settle();
  assert.deepEqual(executed, [], "peer owns the swap; dispose skips restore");
});

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
