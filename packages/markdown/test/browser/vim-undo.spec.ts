import { test, expect } from "@playwright/test";
import { open } from "./harness";

async function openVim(page: Parameters<typeof open>[0], source: string) {
  await open(page, source, "obsidian", {
    features: { vim: { enabled: true, config: {} } },
  });
  await page
    .getByRole("textbox", { name: "Markdown content", exact: true })
    .focus();
}

test("Vim insert typing then Esc then u undoes via host history", async ({
  page,
}) => {
  const source = "Start\n";
  await openVim(page, source);
  await page.keyboard.press("Escape");
  // A appends at end of the current line ("Start"), before the trailing \n.
  await page.keyboard.press("A");
  await page.keyboard.type("Hello");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("StartHello\n");
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe(source);
});

test("Vim insert typing then Esc then Ctrl+Z undoes via host history", async ({
  page,
}) => {
  const source = "Start\n";
  await openVim(page, source);
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await page.keyboard.type("Hi");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("HiStart\n");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe(source);
});

test("Vim insert typing then Esc then :u undoes via host history", async ({
  page,
}) => {
  const source = "Start\n";
  await openVim(page, source);
  await page.keyboard.press("Escape");
  await page.keyboard.press("A");
  await page.keyboard.type("X");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("StartX\n");
  await page.keyboard.press("Escape");
  await page.keyboard.press(":");
  await page.keyboard.type("u");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe(source);
});

test("one Vim insert session undoes as a single host step even with a pause", async ({
  page,
}) => {
  const source = "Start\n";
  await openVim(page, source);
  await page.keyboard.press("Escape");
  await page.keyboard.press("A");
  await page.keyboard.type("ab");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("Startab\n");
  // Longer than plain-input's 500ms window — must still be one Vim insert atom.
  await page.waitForTimeout(700);
  await page.keyboard.type("cd");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("Startabcd\n");
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe(source);
});
