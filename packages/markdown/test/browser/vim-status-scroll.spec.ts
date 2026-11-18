/**
 * With Vim on and the host showing the mode in its status bar, the note's Vim
 * panel is closed. CodeMirror measures a mounted bottom panel for its scroll
 * margins, so a panel hidden with CSS made every point "inside the bottom
 * margin": dragging a selection autoscrolled and gg / G left the caret out of
 * view. These hold the editor's scrolling to what it is without Vim's panel.
 */
import { expect, test, type Page } from "@playwright/test";
import { open } from "./harness";

function longNote(sections: number): string {
  const parts = ["# Long note", ""];
  for (let i = 1; i <= sections; i++) {
    parts.push(`## Section ${i}`, "");
    parts.push(
      `Paragraph ${i} has enough words to wrap across the editor's width so the note is tall, and so a drag inside it crosses several visual lines of prose.`,
      "",
      `- item ${i}.1`,
      `- item ${i}.2`,
      "",
    );
  }
  parts.push("The last line.");
  return parts.join("\n");
}

const NOTE = longNote(60);
const vim = { vim: { enabled: true, config: {} } };
const modes = {
  plain: { features: {} },
  vim: { features: vim },
  "vim-status": { features: vim, vimStatusBar: true },
} as const;

/** A scroller shorter than the window, as in a VS Code editor group. */
async function constrain(page: Page) {
  await page.addStyleTag({
    content:
      "#app, #app .cm-editor, #app .cm-scroller { height: 640px !important; max-height: 640px !important; } #app .cm-scroller { overflow: auto !important; }",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
}

async function openNote(page: Page, mode: keyof typeof modes) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, NOTE, "obsidian", modes[mode]);
  await constrain(page);
}

const scrollTop = (page: Page) =>
  page.locator(".cm-scroller").evaluate((el) => Math.round(el.scrollTop));

for (const mode of Object.keys(modes) as (keyof typeof modes)[]) {
  test(`dragging a selection inside the viewport does not scroll (${mode})`, async ({
    page,
  }) => {
    await openNote(page, mode);
    const scroller = page.locator(".cm-scroller");
    for (const start of [0, 1200, 3000]) {
      await scroller.evaluate((el, y) => (el.scrollTop = y), start);
      await page.waitForTimeout(200);
      const before = await scrollTop(page);
      const box = (await scroller.boundingBox())!;
      const x = box.x + 120;
      const y = box.y + 200;
      await page.mouse.move(x, y);
      await page.mouse.down();
      const trace: number[] = [];
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(x + i * 30, y + i * 12);
        await page.waitForTimeout(30);
        trace.push(await scrollTop(page));
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await scrollTop(page);
      expect(
        Math.abs(after - before),
        `from ${start}, scrollTop during the drag: ${trace}`,
      ).toBeLessThan(2);
    }
  });
}

/**
 * Where the caret is relative to the scroller, below the host's inset and
 * below any sticky headings.
 */
async function caretPlacement(page: Page) {
  return await page.evaluate(() => {
    const fiber = [...window.harness.views[0]!.plugins].find(
      (plugin) => plugin.definition.name === "vim",
    );
    const view = fiber!.context!.editor.view;
    const caret = view.coordsAtPos(view.state.selection.main.head);
    const scroller = view.scrollDOM.getBoundingClientRect();
    const inset =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--lumiere-inset-top",
        ),
      ) || 0;
    const sticky = document.querySelector(".mw-sticky-scroll");
    const stickyBottom =
      sticky && sticky.getBoundingClientRect().height > 0
        ? sticky.getBoundingClientRect().bottom
        : 0;
    return {
      caret: caret && { top: caret.top, bottom: caret.bottom },
      visibleTop: Math.max(scroller.top + inset, stickyBottom),
      visibleBottom: scroller.bottom,
    };
  });
}

async function expectCaretVisible(page: Page, label: string) {
  await page.waitForTimeout(200);
  const placement = await caretPlacement(page);
  const message = `${label}: ${JSON.stringify(placement)}`;
  expect(placement.caret, message).not.toBeNull();
  expect(placement.caret!.top, message).toBeGreaterThanOrEqual(
    placement.visibleTop - 1,
  );
  expect(placement.caret!.bottom, message).toBeLessThanOrEqual(
    placement.visibleBottom + 1,
  );
}

for (const inset of [0, 40]) {
  test(`G and gg keep the caret in view with the mode in the host status bar (inset ${inset}px)`, async ({
    page,
  }) => {
    await openNote(page, "vim-status");
    await page.evaluate(
      (px) =>
        document.documentElement.style.setProperty(
          "--lumiere-inset-top",
          `${px}px`,
        ),
      inset,
    );
    await page.getByRole("textbox", { name: "Markdown content" }).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => window.harness.vimStatus.at(-1)))
      .toBe("-- NORMAL --");

    await page.keyboard.type("G");
    await expectCaretVisible(page, "G");
    await page.keyboard.type("gg");
    await expectCaretVisible(page, "gg");

    // Scroll with the wheel first, so the caret starts out of view.
    const scroller = page.locator(".cm-scroller");
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(200);
    await page.keyboard.type("G");
    await expectCaretVisible(page, "wheel down, then G");
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(200);
    await page.keyboard.type("gg");
    await expectCaretVisible(page, "wheel up, then gg");
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(200);
    await page.keyboard.type("G");
    await expectCaretVisible(page, "wheel down again, then G");
    expect(await page.evaluate(() => window.harness.text)).toBe(NOTE);
  });
}
