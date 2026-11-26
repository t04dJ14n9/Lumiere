import assert from "node:assert/strict";
import test from "node:test";
import type { StatusHandle, WorkbenchViews } from "../../shared/host";
import { createJumpStatus } from "./jump-status";

interface Shown {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
}

function fakeViews(statusBar = true) {
  const entries = new Map<
    string,
    { priority: number; shown: Shown | undefined; disposed: boolean }
  >();
  const views = {
    statusBar,
    status(id: string, priority: number): StatusHandle {
      const entry: {
        priority: number;
        shown: Shown | undefined;
        disposed: boolean;
      } = {
        priority,
        shown: undefined,
        disposed: false,
      };
      entries.set(id, entry);
      return {
        show(text, tooltip, command) {
          entry.shown = { text, tooltip, command };
        },
        hide() {
          entry.shown = undefined;
        },
        dispose() {
          entry.disposed = true;
        },
      };
    },
  } as unknown as WorkbenchViews;
  return { views, entries };
}

test("the arrows show while a note is active, with a command only where they can go", () => {
  const { views, entries } = fakeViews();
  const status = createJumpStatus(views);
  status.update({ isNoteActive: true, canBack: true, canForward: false });
  const back = entries.get("lumiere.markdown.jumpBack")!;
  const forward = entries.get("lumiere.markdown.jumpForward")!;
  assert.equal(back.shown?.text, "$(arrow-left)");
  assert.equal(back.shown?.command, "lumiere.markdown.jumpBack");
  assert.equal(forward.shown?.text, "$(arrow-right)");
  assert.equal(forward.shown?.command, undefined);
  assert.ok(back.priority > forward.priority, "back sits left of forward");
  assert.ok(
    forward.priority > 100,
    "both sit left of word count and backlinks",
  );

  status.update({ isNoteActive: false, canBack: true, canForward: true });
  assert.equal(back.shown, undefined);
  assert.equal(forward.shown, undefined);

  status.dispose();
  assert.ok(back.disposed && forward.disposed);
});

test("without a status bar the arrows are never made", () => {
  const { views, entries } = fakeViews(false);
  const status = createJumpStatus(views);
  status.update({ isNoteActive: true, canBack: true, canForward: true });
  status.dispose();
  assert.equal(entries.size, 0);
  createJumpStatus(undefined).update({
    isNoteActive: true,
    canBack: false,
    canForward: false,
  });
});
