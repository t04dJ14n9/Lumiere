import test from "node:test";
import assert from "node:assert/strict";
import { contributions } from "../../../scripts/contributions";
import { switchesUnavailableIn } from "../catalog";

test("Look Up is in the note's menu on macOS only, over the note's text", async () => {
  const generated = await contributions();
  const item = generated.menus["webview/context"].find(
    (entry) => entry.command === "lumiere.markdown.lookUp",
  );
  assert.ok(item);
  const clauses = item.when.split(" && ");
  for (const clause of [
    "webviewId == 'lumiere.markdown.editor'",
    "lumiere.markdown.plugin.lookUp",
    "isMac",
    "webviewSection == 'markdownContent'",
  ]) {
    assert.ok(clauses.includes(clause), clause);
  }
});

test("Look Up follows Copy link to this in the menu and stays out of the palette", async () => {
  const generated = await contributions();
  const group = (command: string) =>
    generated.menus["webview/context"].find(
      (entry) => entry.command === command,
    )?.group ?? "";
  const lookUp = group("lumiere.markdown.lookUp");
  const copyLink = group("lumiere.markdown.copyLinkForAgent");
  assert.ok(copyLink && lookUp);
  // VS Code orders a menu by group name, then by the order after the @.
  const [lookUpSection, lookUpOrder] = lookUp.split("@");
  const [copySection, copyOrder] = copyLink.split("@");
  assert.ok(
    lookUpSection! > copySection! ||
      (lookUpSection === copySection &&
        Number(lookUpOrder) > Number(copyOrder)),
    `${lookUp} after ${copyLink}`,
  );
  assert.equal(
    generated.menus.commandPalette.find(
      (entry) => entry.command === "lumiere.markdown.lookUp",
    )?.when,
    "false",
  );
});

test("outside VS Code and Cursor, where the menu has no isMac to show the item, Look Up stays off", () => {
  assert.ok(
    switchesUnavailableIn([]).has("lumiere.markdown.plugins.lookUp.enabled"),
  );
  assert.ok(
    !switchesUnavailableIn(["workbench"]).has(
      "lumiere.markdown.plugins.lookUp.enabled",
    ),
  );
});
