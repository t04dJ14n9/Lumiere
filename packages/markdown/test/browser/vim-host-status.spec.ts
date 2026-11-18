import { expect, test, type Page } from "@playwright/test";
import { open } from "./harness";

const TEXT = `hello prose

| alpha | beta  |
| ----- | ----- |
| gamma | delta |
`;
const vim = { vim: { enabled: true, config: {} } };
const lastStatus = (page: Page) =>
  page.evaluate(() => window.harness.vimStatus.at(-1));

test("with a host status bar the mode goes there and the panel opens only for prompts", async ({
  page,
}) => {
  await open(page, TEXT, "obsidian", { features: vim, vimStatusBar: true });
  const editor = page.getByRole("textbox", { name: "Markdown content" });
  await editor.click();
  await page.keyboard.press("Escape");
  const panel = page.locator(".cm-editor > .cm-panels-bottom");
  await expect(panel).toBeHidden();
  await expect.poll(() => lastStatus(page)).toBe("-- NORMAL --");
  await page.keyboard.type("d");
  await expect.poll(() => lastStatus(page)).toBe("-- NORMAL --  d");
  await page.keyboard.press("Escape");
  await page.keyboard.type("i");
  await expect.poll(() => lastStatus(page)).toBe("-- INSERT --");
  await page.keyboard.press("Escape");
  await page.keyboard.type("V");
  await expect.poll(() => lastStatus(page)).toBe("-- VISUAL LINE --");
  await page.keyboard.press("Escape");
  await page.keyboard.type(":");
  const prompt = page.locator(".cm-vim-panel input");
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(panel).toBeHidden();
  await page.keyboard.type("/zzz");
  await page.keyboard.press("Enter");
  // A Vim message (pattern not found) shows in the panel.
  await expect(page.locator(".cm-vim-panel")).toBeVisible();
  expect(await page.evaluate(() => window.harness.text)).toBe(TEXT);
});

test("a table cell's : prompt still shows on the hidden note panel", async ({
  page,
}) => {
  await open(page, TEXT, "obsidian", { features: vim, vimStatusBar: true });
  await page.locator(".hybrid-table .table-cell-content").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.type(":w");
  const prompt = page.locator(".cm-vim-panel input");
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue("w");
  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(
    page.locator(".cm-editor > .cm-panels-bottom").first(),
  ).toBeHidden();
});

test("without a host status bar Vim's own panel keeps the mode", async ({
  page,
}) => {
  await open(page, TEXT, "obsidian", { features: vim });
  await page.getByRole("textbox", { name: "Markdown content" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-vim-panel").first()).toContainText(
    "--NORMAL--",
  );
  expect(await page.evaluate(() => window.harness.vimStatus.length)).toBe(0);
});
