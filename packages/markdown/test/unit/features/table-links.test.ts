import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { cellKeymap } from "../../../src/plugins/tables/cell-editor";
import { fixture } from "./fixture";
import type { LinksService } from "../../../src/plugins/links/api";

test("the link keys follow the active cell's link through Links; the outer focus guard ignores cell focus", async () => {
  const f = fixture();
  await f.configure({ links: { enabled: true, config: {} } });
  let links: LinksService | undefined;
  f.root.plugin({
    name: "cell-link-test",
    inject: { required: ["links"] },
    apply(ctx) {
      links = ctx.links;
    },
  });
  await f.root.settled();
  assert.ok(links);
  const opened: { href: string; wiki: boolean }[] = [];
  f.root.on("link/click", (request) => {
    opened.push(request);
    return true;
  });
  const outerContent = {};
  const cellContent = {};
  const ownerDocument = { activeElement: cellContent };
  Object.assign(f.view, {
    contentDOM: outerContent,
    dom: { ownerDocument },
    composing: false,
  });
  f.view.dispatch({
    changes: { from: 0, to: f.view.state.doc.length, insert: "[[Outer]]" },
    selection: { anchor: 4 },
  });
  const state = EditorState.create({
    doc: "[[Cell#Heading|label]]",
    selection: { anchor: 6 },
    extensions: cellKeymap({
      environment: { links },
    } as Parameters<typeof cellKeymap>[0]),
  });
  const cell = {
    state,
    contentDOM: cellContent,
    dom: { ownerDocument },
    composing: false,
  } as unknown as EditorView;
  const binding = (view: EditorView, key: string) =>
    view.state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === key)!;
  for (const key of ["Alt-Enter", "Mod-Enter", "Mod-Alt-Enter"]) {
    assert.equal(binding(f.view, key).run!(f.view), false, key);
    // VS Code must not run its binding for the key a second time.
    assert.equal(binding(cell, key).stopPropagation, true, key);
    assert.equal(binding(cell, key).run!(cell), true, key);
  }
  assert.deepEqual(opened, [
    { href: "Cell#Heading", wiki: true, side: false, tab: false },
    { href: "Cell#Heading", wiki: true, side: false, tab: true },
    { href: "Cell#Heading", wiki: true, side: true, tab: false },
  ]);
  ownerDocument.activeElement = outerContent;
  assert.equal(binding(f.view, "Alt-Enter").run!(f.view), true);
  assert.equal(opened.at(-1)?.href, "Outer");
  await f.root.dispose();
});

test("cells without the optional Links service leave the link keys unhandled", () => {
  const state = EditorState.create({
    extensions: cellKeymap({ environment: {} } as Parameters<
      typeof cellKeymap
    >[0]),
  });
  for (const key of ["Alt-Enter", "Mod-Enter", "Mod-Alt-Enter"]) {
    const binding = state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === key)!;
    assert.equal(binding.run!({ state } as EditorView), false, key);
  }
});
