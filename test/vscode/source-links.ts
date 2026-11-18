/**
 * Clicking links in VS Code's own text editor, shared by the Markdown
 * (test/vscode) and PDF (packages/pdf/test/vscode) native-link specs.
 */
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The status bar's caret ("Ln 1, Col 23") once it holds still. VS Code shows
 * a click's caret a moment after the click: read at once, a click on the
 * caret's line can still show the old column.
 */
export async function settledCaret(status: Locator): Promise<string> {
  let last = "";
  let unchanged = 0;
  await expect
    .poll(
      async () => {
        const now = await status.innerText();
        unchanged = now === last ? unchanged + 1 : 0;
        last = now;
        return unchanged >= 2;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return last;
}

/**
 * Ctrl-click (Cmd-click on macOS) a detected link where it is on screen.
 * VS Code draws the link's span again once the caret moves onto its line,
 * so an element Playwright already found can be detached ("not visible").
 */
export async function modifierClick(page: Page, link: Locator): Promise<void> {
  await expect(link).toBeVisible();
  let box = await link.boundingBox();
  await expect
    .poll(async () => (box = await link.boundingBox()) !== null)
    .toBe(true);
  box = box!;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up(modifier);
}
