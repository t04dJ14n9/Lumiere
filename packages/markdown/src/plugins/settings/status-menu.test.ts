import assert from "node:assert/strict";
import test from "node:test";
import { toggles } from "./commands";
import { settingsMenuItems } from "./status-menu";

test("the menu lists every toggle with its state, then the ways to all settings", () => {
  const on = new Set(["plugins.vim.enabled", "editor.readableLineLength"]);
  const items = settingsMenuItems({
    isOn: (key) => on.has(key),
    mode: "source",
  });
  const commands = items.map((item) => item.value.command);
  assert.deepEqual(commands, [
    "toggleSourceMode",
    ...toggles.map((toggle) => toggle.command),
    "changeSetting",
    "managePlugins",
    "openSettings",
  ]);
  const row = (command: string) =>
    items.find((item) => item.value.command === command)!;
  assert.match(row("toggleSourceMode").label, /^\$\(check\) /);
  assert.match(row("toggleVim").label, /^\$\(check\) /);
  assert.equal(row("toggleVim").description, "On");
  assert.match(row("toggleLineNumbers").label, /^\$\(blank\) /);
  assert.equal(row("toggleLineNumbers").description, "Off");
  assert.equal(new Set(items.slice(0, -3).map((item) => item.group)).size, 1);
  assert.notEqual(items.at(-1)!.group, items[0]!.group);
});

test("without an active note's mode the menu leaves out Source mode", () => {
  const items = settingsMenuItems({ isOn: () => false });
  assert.equal(
    items.some((item) => item.value.command === "toggleSourceMode"),
    false,
  );
});

test("the Vim entry says whether Vim is on", async () => {
  const { vimStatusText } = await import("./status");
  assert.equal(vimStatusText(true).text, "$(keyboard) Vim");
  assert.equal(vimStatusText(false).text, "$(keyboard) Vim off");
  assert.match(vimStatusText(true).tooltip, /turn it off/);
});
