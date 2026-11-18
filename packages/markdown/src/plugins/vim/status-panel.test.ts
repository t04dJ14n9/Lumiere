import test from "node:test";
import assert from "node:assert/strict";
import { hasPrompt, isVimPanelOpen } from "./status-panel";

test("the panel stays open for the mode line unless the host shows the mode", () => {
  assert.equal(
    isVimPanelOpen({ hostShowsMode: false, hasPrompt: false }),
    true,
  );
  assert.equal(isVimPanelOpen({ hostShowsMode: false, hasPrompt: true }), true);
  assert.equal(
    isVimPanelOpen({ hostShowsMode: true, hasPrompt: false }),
    false,
  );
  assert.equal(isVimPanelOpen({ hostShowsMode: true, hasPrompt: true }), true);
});

test("a prompt or message is a <div>; the mode line is <span>s", () => {
  const panel = (...tags: string[]) => ({
    children: tags.map((tagName) => ({ tagName })) as unknown as HTMLCollection,
  });
  assert.equal(hasPrompt(panel()), false);
  assert.equal(hasPrompt(panel("SPAN", "SPAN", "SPAN")), false);
  assert.equal(hasPrompt(panel("DIV", "SPAN")), true);
});
