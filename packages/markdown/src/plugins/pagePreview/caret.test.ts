import test from "node:test";
import assert from "node:assert/strict";
import type { EditorView } from "@codemirror/view";
import { linkAtCaret } from "./caret";

/** An element whose `closest` finds `link` when it is inside it. */
const element = (link: unknown) => ({
  nodeType: 1,
  closest: () => link,
  childNodes: [] as unknown[],
});

function view(at: { node: unknown; offset: number }, inside = true) {
  return {
    state: { selection: { main: { head: 0 } } },
    domAtPos: () => at,
    contentDOM: { contains: () => inside },
  } as unknown as EditorView;
}

test("Preview Link at Caret takes the link the caret's text is in, or the one beside it", () => {
  const link = { tagName: "SPAN" };
  const text = { nodeType: 3, parentElement: element(link), childNodes: [] };
  assert.equal(linkAtCaret(view({ node: text, offset: 2 })), link);
  // The position is on the line, between children: the link before it counts.
  const line = { ...element(null), childNodes: [element(link), text] };
  assert.equal(linkAtCaret(view({ node: line, offset: 1 })), link);
  // Plain text, and a link outside this editor's text, are not previewed.
  const plain = { nodeType: 3, parentElement: element(null), childNodes: [] };
  assert.equal(linkAtCaret(view({ node: plain, offset: 0 })), undefined);
  assert.equal(linkAtCaret(view({ node: text, offset: 2 }, false)), undefined);
});
