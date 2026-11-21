import assert from "node:assert/strict";
import test from "node:test";
import { keymap, type EditorView } from "@codemirror/view";
import { fixture } from "./fixture";

// Obsidian 1.15.0's default for editor:open-link-in-new-split.
test("Mod-Alt-Enter opens the caret's link beside, and Mod-Enter still follows it in place", async () => {
  const f = fixture();
  await f.configure({ links: { enabled: true, config: {} } });
  await f.root.settled();
  const opened: { href: string; side?: boolean; tab?: boolean }[] = [];
  f.root.on("link/click", (request) => {
    opened.push(request);
    return true;
  });
  const content = {};
  Object.assign(f.view, {
    contentDOM: content,
    dom: { ownerDocument: { activeElement: content } },
    composing: false,
  });
  f.view.dispatch({
    changes: { from: 0, to: f.view.state.doc.length, insert: "[[Target]]" },
    selection: { anchor: 4 },
  });
  const binding = (key: string) =>
    f.view.state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === key)!;
  const beside = binding("Mod-Alt-Enter");
  // Handled here, so VS Code's contributed binding does not run it again.
  assert.equal(beside.stopPropagation, true);
  assert.equal(beside.run!(f.view as EditorView), true);
  assert.equal(binding("Mod-Enter").run!(f.view as EditorView), true);
  assert.deepEqual(
    opened.map(({ href, side, tab }) => ({ href, side, tab })),
    [
      { href: "Target", side: true, tab: false },
      { href: "Target", side: false, tab: false },
    ],
  );
  f.view.dispatch({
    changes: { from: 0, to: f.view.state.doc.length, insert: "plain" },
  });
  // No link at the caret: the key is left to other handlers.
  assert.equal(beside.run!(f.view as EditorView), false);
  await f.root.dispose();
});
