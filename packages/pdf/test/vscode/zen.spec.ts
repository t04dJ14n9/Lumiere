import type { Frame, Page } from "@playwright/test";
import {
  PAGE_STATUS,
  command,
  expect as baseExpect,
  openFile,
  pageAtTop,
  pdfViewer,
  quickInputTitled,
  statusBarEntry,
  test,
} from "./workbench";

// Zen resizes the whole window, which takes a while on a busy runner.
const expect = baseExpect.configure({ timeout: 30_000 });

// PDF zen mode is core Zen Mode, entered and left with the extension's own
// commands and keys. The status bar goes while it lasts, and the viewer adds
// no bar of its own (the floating bar was removed): the PDF controls are the
// command palette and the keyboard until zen ends (docs/zen.md). Whether the
// window goes full screen is VS Code's business (and needs a window manager);
// what is tested is what the extension adds.

const PDF = "docs/outline.pdf";
const modifier = process.platform === "darwin" ? "Control+Meta" : "Control+Alt";

const statusBar = (page: Page) => page.locator(".part.statusbar");
const viewerBar = (viewer: Frame) =>
  viewer.getByRole("toolbar", { name: "PDF toolbar" });

/** Give the viewer the keyboard focus, so shortcuts reach it as a reader's would. */
async function focusViewer(viewer: Frame): Promise<void> {
  await viewer.locator(".viewport").focus();
  await expect
    .poll(() => viewer.evaluate(() => document.hasFocus()))
    .toBe(true);
}

async function leaveZen(page: Page): Promise<void> {
  // Core's own chord toggles zen: only when it is still on.
  if (await statusBar(page).isVisible()) {
    return;
  }
  await page.keyboard.press("Control+k");
  await page.keyboard.press("z");
}

/** Go to `number` with the viewer's Go to Page key, until the page stays at the top. */
async function goToPageByKey(
  page: Page,
  viewer: Frame,
  number: number,
): Promise<void> {
  // Entering zen resizes the window and the pages are laid out again, which
  // can take a jump to a page with it: go to the page until it stays.
  await expect
    .poll(
      async () => {
        await focusViewer(viewer);
        await page.keyboard.press("Control+g");
        const input = quickInputTitled(page, /^Go to Page/u);
        // The box gets its value (the current page) after it opens: typing
        // before then would be overwritten.
        await expect(input).toHaveValue(/^\d+$/u);
        await input.fill(String(number));
        await input.press("Enter");
        await page.waitForTimeout(400);
        return pageAtTop(viewer, number);
      },
      { timeout: 30_000, intervals: [200] },
    )
    .toBe(true);
}

test("Enter and Exit Zen Mode from the palette: the status bar goes and comes back, and the keyboard still drives the PDF in between", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(viewer.locator(".page img").first()).toBeVisible();
  try {
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
    await command(page, "PDF: Enter Zen Mode");
    await expect(statusBar(page)).toBeHidden();
    await expect(viewerBar(viewer)).toHaveCount(0);
    await page.screenshot({ path: "test-results/zen-on.png" });
    await goToPageByKey(page, viewer, 3);
    await command(page, "PDF: Exit Zen Mode");
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, /^Page 3 \/ 12$/u)).toBeVisible();
    await expect(viewerBar(viewer)).toHaveCount(0);
  } finally {
    await leaveZen(page);
  }
});

test("Ctrl+Alt+Z (Ctrl+Cmd+Z on macOS) enters zen from the PDF and leaves it; so does Escape Escape", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(viewer.locator(".page img").first()).toBeVisible();
  await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  try {
    await focusViewer(viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeHidden();
    await focusViewer(viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();

    await focusViewer(viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeHidden();
    await focusViewer(viewer);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  } finally {
    await leaveZen(page);
  }
});
