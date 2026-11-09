import type { Frame, Page } from "@playwright/test";
import {
  PAGE_STATUS,
  command,
  expect as baseExpect,
  focusViewer,
  goToPage,
  openFile,
  pageAtTop,
  pdfViewer,
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

/**
 * Leave zen if a failed step left it on, so the next tests find the status
 * bar. With the exit-only command: the toggle chord would turn zen back on if
 * it is already on its way out, and Escape starts VS Code's Escape Escape
 * chord, which can swallow the next test's first key.
 */
async function leaveZen(page: Page): Promise<void> {
  if (await statusBar(page).isVisible()) {
    return;
  }
  await command(page, "PDF: Exit Zen Mode");
  await expect(statusBar(page)).toBeVisible();
}

/**
 * Go to `number` with the viewer's Go to Page key. Entering zen resizes the
 * window and lays the pages out again, which can swallow the key or move the
 * place with it: try again until the page stays at the top.
 */
async function goToPageInZen(
  page: Page,
  viewer: Frame,
  number: number,
): Promise<void> {
  await expect(async () => {
    // Focusing the viewer also closes a Go to Page box a failed try left open.
    await focusViewer(page, viewer);
    await goToPage(page, viewer, number, () =>
      page.keyboard.press("Control+g"),
    );
    await page.waitForTimeout(400);
    baseExpect(await pageAtTop(viewer, number)).toBe(true);
  }).toPass({ timeout: 45_000 });
}

test("Enter and Exit Zen Mode from the palette: the status bar goes and comes back, and the keyboard still drives the PDF in between", async ({
  workbench: page,
}) => {
  test.slow();
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(viewer.locator(".page img").first()).toBeVisible();
  try {
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
    await command(page, "PDF: Enter Zen Mode");
    await expect(statusBar(page)).toBeHidden();
    await page.screenshot({ path: "test-results/zen-on.png" });
    await goToPageInZen(page, viewer, 3);
    // Checked once the viewer has answered a key in zen: a bar zen brought
    // would be drawn by then.
    await expect(viewerBar(viewer)).toHaveCount(0);
    await command(page, "PDF: Exit Zen Mode");
    // Leaving zen lays the pages out again, which can move the place by a
    // page: only the entry's return is checked.
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
    await expect(viewerBar(viewer)).toHaveCount(0);
  } finally {
    await leaveZen(page);
  }
});

// VS Code itself binds Escape Escape to leave zen as well, so its step shows
// what a reader gets, not that the extension's own binding works.
test("Ctrl+Alt+Z (Ctrl+Cmd+Z on macOS) enters zen from the PDF and leaves it; so does Escape Escape", async ({
  workbench: page,
}) => {
  test.slow();
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(viewer.locator(".page img").first()).toBeVisible();
  await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  try {
    await focusViewer(page, viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeHidden();
    await focusViewer(page, viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();

    await focusViewer(page, viewer);
    await page.keyboard.press(`${modifier}+z`);
    await expect(statusBar(page)).toBeHidden();
    await focusViewer(page, viewer);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(statusBar(page)).toBeVisible();
    await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  } finally {
    await leaveZen(page);
  }
});
