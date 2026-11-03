import { test, expect, type Page } from "@playwright/test";
import { open } from "./harness";

async function openVim(page: Page, source: string) {
  await open(page, source, "obsidian", {
    features: { vim: { enabled: true, config: {} } },
  });
  await page
    .getByRole("textbox", { name: "Markdown content", exact: true })
    .focus();
  await page.keyboard.press("Escape");
}

async function text(page: Page) {
  return page.evaluate(() => window.harness.text);
}

async function expectText(page: Page, expected: string) {
  await expect.poll(() => text(page)).toBe(expected);
}

test.describe("Vim normal-mode edit command audit", () => {
  test("x and X delete characters", async ({ page }) => {
    await openVim(page, "abcd\n");
    await page.keyboard.press("l"); // on b
    await page.keyboard.press("x");
    await expectText(page, "acd\n");
    await page.keyboard.press("X");
    await expectText(page, "cd\n");
  });

  test("dd deletes a line", async ({ page }) => {
    await openVim(page, "one\ntwo\nthree\n");
    await page.keyboard.press("j");
    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await expectText(page, "one\nthree\n");
  });

  test("D deletes to end of line", async ({ page }) => {
    await openVim(page, "alpha beta\n");
    await page.keyboard.press("w"); // on 'b' of beta
    await page.keyboard.press("D");
    // Vim keeps the space before the deleted word.
    await expectText(page, "alpha \n");
  });

  test("dw deletes a word", async ({ page }) => {
    await openVim(page, "alpha beta gamma\n");
    await page.keyboard.press("d");
    await page.keyboard.press("w");
    await expectText(page, "beta gamma\n");
  });

  test("cc changes a line into insert", async ({ page }) => {
    await openVim(page, "old\nkeep\n");
    await page.keyboard.press("c");
    await page.keyboard.press("c");
    await page.keyboard.type("new");
    await page.keyboard.press("Escape");
    await expectText(page, "new\nkeep\n");
  });

  test("C changes to end of line", async ({ page }) => {
    await openVim(page, "hello world\n");
    await page.keyboard.press("w");
    await page.keyboard.press("C");
    await page.keyboard.type("there");
    await page.keyboard.press("Escape");
    await expectText(page, "hello there\n");
  });

  test("cw changes a word", async ({ page }) => {
    await openVim(page, "alpha beta\n");
    await page.keyboard.press("c");
    await page.keyboard.press("w");
    await page.keyboard.type("ALPHA");
    await page.keyboard.press("Escape");
    await expectText(page, "ALPHA beta\n");
  });

  test("yy and p yank and paste a line", async ({ page }) => {
    await openVim(page, "one\ntwo\n");
    await page.keyboard.press("y");
    await page.keyboard.press("y");
    await page.keyboard.press("p");
    await expectText(page, "one\none\ntwo\n");
  });

  test("Y yanks the line", async ({ page }) => {
    await openVim(page, "one\ntwo\n");
    await page.keyboard.press("Y");
    await page.keyboard.press("j");
    await page.keyboard.press("p");
    await expectText(page, "one\ntwo\none\n");
  });

  test("yw and P paste before", async ({ page }) => {
    await openVim(page, "alpha beta\n");
    await page.keyboard.press("y");
    await page.keyboard.press("w");
    await page.keyboard.press("w");
    await page.keyboard.press("P");
    await expectText(page, "alpha alpha beta\n");
  });

  test("r replaces one character", async ({ page }) => {
    await openVim(page, "cat\n");
    await page.keyboard.press("l");
    await page.keyboard.press("r");
    await page.keyboard.press("o");
    await expectText(page, "cot\n");
  });

  test("R replaces in replace mode until Esc", async ({ page }) => {
    await openVim(page, "abcd\n");
    await page.keyboard.press("R");
    await page.keyboard.type("XY");
    await page.keyboard.press("Escape");
    await expectText(page, "XYcd\n");
  });

  test("~ toggles case", async ({ page }) => {
    await openVim(page, "Ab\n");
    await page.keyboard.press("~");
    await expectText(page, "ab\n");
    await page.keyboard.press("~");
    await expectText(page, "aB\n");
  });

  test("J joins lines", async ({ page }) => {
    await openVim(page, "one\ntwo\n");
    await page.keyboard.press("J");
    await expectText(page, "one two\n");
  });

  test(">> and << indent and outdent", async ({ page }) => {
    await openVim(page, "one\n");
    await page.keyboard.press(">");
    await page.keyboard.press(">");
    await expect
      .poll(async () => {
        const value = await text(page);
        return value.startsWith("\t") || value.startsWith("  ");
      })
      .toBe(true);
    const indented = await text(page);
    await page.keyboard.press("<");
    await page.keyboard.press("<");
    await expectText(page, "one\n");
    expect(indented).not.toBe("one\n");
  });

  test(". repeats the last edit", async ({ page }) => {
    await openVim(page, "abc\n");
    await page.keyboard.press("x");
    await expectText(page, "bc\n");
    await page.keyboard.press(".");
    await expectText(page, "c\n");
  });

  test("i a I A o O enter insert and edit", async ({ page }) => {
    await openVim(page, "mid\n");
    await page.keyboard.press("i");
    await page.keyboard.type("X");
    await page.keyboard.press("Escape");
    await expectText(page, "Xmid\n");
    // After Esc, caret rests on X; `a` appends after it.
    await page.keyboard.press("a");
    await page.keyboard.type("Y");
    await page.keyboard.press("Escape");
    await expectText(page, "XYmid\n");
    await page.keyboard.press("I");
    await page.keyboard.type("S");
    await page.keyboard.press("Escape");
    await expectText(page, "SXYmid\n");
    await page.keyboard.press("A");
    await page.keyboard.type("E");
    await page.keyboard.press("Escape");
    await expectText(page, "SXYmidE\n");
    await page.keyboard.press("o");
    await page.keyboard.type("below");
    await page.keyboard.press("Escape");
    await expectText(page, "SXYmidE\nbelow\n");
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await page.keyboard.press("O");
    await page.keyboard.type("above");
    await page.keyboard.press("Escape");
    await expectText(page, "above\nSXYmidE\nbelow\n");
  });

  test("Ctrl+R and :red redo after undo", async ({ page }) => {
    await openVim(page, "Start\n");
    await page.keyboard.press("A");
    await page.keyboard.type("Z");
    await page.keyboard.press("Escape");
    await expectText(page, "StartZ\n");
    await page.keyboard.press("u");
    await expectText(page, "Start\n");
    await page.keyboard.press("Control+r");
    await expectText(page, "StartZ\n");
    await page.keyboard.press("u");
    await expectText(page, "Start\n");
    await page.keyboard.press(":");
    await page.keyboard.type("red");
    await page.keyboard.press("Enter");
    await expectText(page, "StartZ\n");
  });

  test("normal-mode edits undo through host u", async ({ page }) => {
    await openVim(page, "abcd\n");
    await page.keyboard.press("x");
    await expectText(page, "bcd\n");
    await page.keyboard.press("u");
    await expectText(page, "abcd\n");
  });
});
