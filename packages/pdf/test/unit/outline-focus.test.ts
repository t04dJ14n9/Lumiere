import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutlineFocus,
  LEAVE_RESTORE_MS,
  MARKDOWN_LUMIERE_EDITOR,
  NATIVE_OUTLINE_ID,
} from "../../src/extension/plugins/pdfOutline/focus";

/** PDF Outline's view id (`pdfOutline/outline-follower.ts`, which needs VS Code). */
const VIEW_ID = "lumiere.pdf.outline";

test("entering a Lumiere PDF editor runs no view command until PDF Outline is on screen", async () => {
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
  assert.deepEqual(executed, [], "nothing hidden, nothing to restore");
});

test("PDF Outline appearing replaces the native Outline once, without focusing a view", async () => {
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
  assert.ok(!executed.includes(`${VIEW_ID}.focus`));
  executed.length = 0;
  focus.outlineShown();
  focus.sync(true);
  await settle();
  assert.deepEqual(executed, [], "shown again or re-entered is a no-op");
  focus.dispose();
  await settle();
});

test("a PDF activated under an Outline already on screen hides the native Outline at once", async () => {
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

test("PDF Outline appearing with no PDF active hides nothing", async () => {
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

test("leaving a PDF opened under Search restores nothing it did not hide", async () => {
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
  focus.sync(false);
  pending!();
  await settle();
  assert.deepEqual(
    executed,
    [],
    "focusing the native Outline would bring up the Explorer",
  );
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
  assert.deepEqual(executed, []);
  pending!();
  await settle();
  assert.deepEqual(executed, [`${NATIVE_OUTLINE_ID}.focus`, "focusEditor"]);
  focus.dispose();
  await settle();
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
  focus.outlineShown();
  await settle();
  executed.length = 0;
  focus.sync(false);
  focus.sync(true);
  assert.equal(pending, undefined);
  await settle();
  assert.deepEqual(executed, []);
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
  active.viewType = MARKDOWN_LUMIERE_EDITOR;
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
  active.viewType = MARKDOWN_LUMIERE_EDITOR;
  peer.dispose();
  await settle();
  assert.deepEqual(executed, [], "peer owns the swap; dispose skips restore");
});

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
