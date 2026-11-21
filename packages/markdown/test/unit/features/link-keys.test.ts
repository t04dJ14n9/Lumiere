import assert from "node:assert/strict";
import test from "node:test";
import { keymap, type EditorView } from "@codemirror/view";
import { fixture } from "./fixture";

async function linksFixture() {
  const f = fixture();
  await f.configure({ links: { enabled: true, config: {} } });
  await f.root.settled();
  const opened: { href: string; side?: boolean; tab?: boolean }[] = [];
  f.root.on("link/click", (request) => {
    opened.push(request);
    return true;
  });
  const content = {};
  const ownerDocument = { activeElement: content as unknown, body: {} };
  Object.assign(f.view, {
    contentDOM: content,
    dom: { ownerDocument },
    composing: false,
  });
  const write = (text: string, at: number) =>
    f.view.dispatch({
      changes: { from: 0, to: f.view.state.doc.length, insert: text },
      selection: { anchor: at },
    });
  const binding = (key: string) =>
    f.view.state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === key)!;
  const places = () =>
    opened.map(({ href, side, tab }) => ({ href, side, tab }));
  return { f, opened, ownerDocument, write, binding, places };
}

// Obsidian 1.15.0's defaults (owner decision, 2026-11-21): Follow Link,
// Open Link in New Tab and Open Link to Side.
test("Alt-Enter follows the caret's link here, Mod-Enter in a new tab and Mod-Alt-Enter to the side", async () => {
  const { f, write, binding, places } = await linksFixture();
  write("[[Target]]", 4);
  for (const key of ["Alt-Enter", "Mod-Enter", "Mod-Alt-Enter"]) {
    // Handled here, so VS Code's contributed binding does not run it again.
    assert.equal(binding(key).stopPropagation, true, key);
    assert.equal(binding(key).run!(f.view as EditorView), true, key);
  }
  assert.deepEqual(places(), [
    { href: "Target", side: false, tab: false },
    { href: "Target", side: false, tab: true },
    { href: "Target", side: true, tab: false },
  ]);
  write("plain", 2);
  // No link at the caret: the key is left to other handlers.
  for (const key of ["Alt-Enter", "Mod-Enter", "Mod-Alt-Enter"]) {
    assert.equal(binding(key).run!(f.view as EditorView), false, key);
  }
  await f.root.dispose();
});

test("the keys follow reference links and tags, as the commands do", async () => {
  const { f, write, binding, places } = await linksFixture();
  const searched: number[] = [];
  f.root.on("links/followToken", (_state, at) => {
    searched.push(at);
    return true;
  });
  write("[text][r]\n\n[r]: https://example.com", 2);
  assert.equal(binding("Mod-Enter").run!(f.view as EditorView), true);
  assert.deepEqual(places(), [
    { href: "https://example.com", side: false, tab: true },
  ]);
  write("#tag", 2);
  assert.equal(binding("Alt-Enter").run!(f.view as EditorView), true);
  assert.deepEqual(searched, [2]);
  await f.root.dispose();
});

test("the link commands open at their place and leave a key typed in a field of the note alone", async () => {
  const { f, ownerDocument, write, places } = await linksFixture();
  write("[[Target]]", 4);
  const run = (id: string) => f.handlers.get(id)!();
  assert.equal(await run("editor:follow-link"), true);
  assert.equal(await run("editor:open-link-in-new-leaf"), true);
  assert.equal(await run("editor:open-link-in-new-split"), true);
  // From the Command Palette the focus is where it was: the text or nothing.
  ownerDocument.activeElement = ownerDocument.body;
  assert.equal(await run("editor:follow-link"), true);
  assert.deepEqual(places(), [
    { href: "Target", side: false, tab: false },
    { href: "Target", side: false, tab: true },
    { href: "Target", side: true, tab: false },
    { href: "Target", side: false, tab: false },
  ]);
  // VS Code runs the command for a key a property or the Vim prompt left alone.
  ownerDocument.activeElement = {};
  assert.equal(await run("editor:open-link-in-new-leaf"), false);
  assert.equal(places().length, 4);
  await f.root.dispose();
});
