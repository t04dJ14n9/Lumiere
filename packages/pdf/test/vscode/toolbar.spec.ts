import type { Frame, Page } from "@playwright/test";
import {
  PAGE_STATUS,
  ZOOM_STATUS,
  contextMenu,
  command,
  editorTitleAction,
  expect,
  goToPage,
  inCursor,
  openFile,
  pageAtTop,
  pagePoint,
  pastedClipboard,
  pdfViewer,
  quickInputTitled,
  selectText,
  showPage,
  statusBarEntry,
  test,
  withoutSpaces,
} from "./workbench";

// The viewer's controls in the editor's own UI (the default `chrome` mode):
// editor title actions, status bar entries and keyboard shortcuts. What the
// viewer does with each action is covered by the browser tests.

const PDF = "docs/outline.pdf";
const TEXT_MIDLINE = 94;

function zoomStatus(page: Page) {
  return statusBarEntry(page, ZOOM_STATUS);
}

/** A status bar button of the viewer, by its id. */
function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

function zoomPercent(label: string): number {
  return Number(/(\d+)%/u.exec(label)![1]);
}

/** Give the viewer the keyboard focus with a click on empty space of a page in view. */
async function focusViewer(
  page: Page,
  viewer: Frame,
  pageNumber: number,
): Promise<void> {
  // The status bar shows a page as soon as it is reached; wait for it to settle at the top.
  await expect.poll(() => pageAtTop(viewer, pageNumber)).toBe(true);
  const at = await pagePoint(viewer, pageNumber);
  await page.mouse.click(...at(20, 20).screen);
}

/**
 * Wait until the pages have stopped scrolling and resizing: after a zoom the
 * pages are laid out again and the viewer scrolls back to its place, and that
 * can start a moment after the zoom is reported.
 */
async function scrollSettled(viewer: Frame): Promise<void> {
  const layout = () =>
    viewer.evaluate(() => {
      const viewport = document.querySelector(".viewport")!;
      return `${viewport.scrollTop}:${viewport.scrollHeight}`;
    });
  let last = await layout();
  let stillFor = 0;
  await expect
    .poll(
      async () => {
        const now = await layout();
        stillFor = now === last ? stillFor + 1 : 0;
        last = now;
        return stillFor >= 3;
      },
      { intervals: [200] },
    )
    .toBe(true);
}

/** The tool the viewer is using, from its class. */
function tool(viewer: Frame): Promise<string> {
  return viewer.evaluate(() =>
    document.querySelector(".viewer")!.classList.contains("tool-region")
      ? "region"
      : "text",
  );
}

async function setToolbarMode(page: Page, label: RegExp): Promise<void> {
  await command(page, "PDF: Choose Toolbar Location…");
  await expect(quickInputTitled(page, /^PDF Viewer Controls/u)).toBeVisible();
  await page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: label })
    .first()
    .click();
}

test("the status bar shows the page and zoom, and opens a page or a zoom when clicked", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(statusBarEntry(page, /^Page 1 \/ 12$/u)).toBeVisible();
  await expect(zoomStatus(page)).toHaveText(/^Fit Width \(\d+%\)$/u);
  // No viewer toolbar: the controls are in the editor's own UI.
  await expect(
    viewer.getByRole("toolbar", { name: "PDF toolbar" }),
  ).toHaveCount(0);
  // Status bar buttons only where the title bar hides the actions.
  await expect(statusBarButton(page, "nextPage")).toHaveCount(inCursor ? 1 : 0);

  await statusBarEntry(page, PAGE_STATUS).click();
  const input = quickInputTitled(page, /^Go to Page/u);
  await expect(input).toHaveValue("1");
  await input.fill("7");
  await input.press("Enter");
  await expect.poll(() => pageAtTop(viewer, 7)).toBe(true);
  await expect(statusBarEntry(page, /^Page 7 \/ 12$/u)).toBeVisible();

  await zoomStatus(page).click();
  const zoomInput = quickInputTitled(page, /^Zoom \(now /u);
  await zoomInput.fill("140");
  await expect(
    page.locator(".quick-input-list .monaco-list-row").first(),
  ).toContainText("140%");
  await zoomInput.press("Enter");
  await expect(zoomStatus(page)).toHaveText("140%");

  await zoomStatus(page).click();
  await expect(quickInputTitled(page, /^Zoom \(now 140%\)/u)).toBeVisible();
  await page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: "Fit Page" })
    .first()
    .click();
  await expect(zoomStatus(page)).toHaveText(/^Fit Page \(\d+%\)$/u);
  // Scrolling the viewer updates the page.
  await viewer
    .locator(".viewport")
    .evaluate((viewport) => viewport.scrollBy(0, viewport.clientHeight * 3));
  await expect(
    statusBarEntry(page, /^Page (9|10|11|12) \/ 12$/u),
  ).toBeVisible();
});

test("editor title actions zoom, fit and switch the selection tool", async ({
  workbench: page,
}) => {
  // Cursor keeps these actions in its "…" menu: each one runs from the palette there.
  test.slow(inCursor);
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(zoomStatus(page)).toHaveText(/^Fit Width/u);

  // One fit button, offering the fit not in use.
  await editorTitleAction(page, "Fit Page");
  await expect(zoomStatus(page)).toHaveText(/^Fit Page/u);
  const fitted = zoomPercent(await zoomStatus(page).innerText());
  await editorTitleAction(page, "Zoom In");
  await expect(zoomStatus(page)).toHaveText(/^\d+%$/u);
  expect(zoomPercent(await zoomStatus(page).innerText())).toBeGreaterThan(
    fitted,
  );
  await editorTitleAction(page, "Zoom Out");
  await editorTitleAction(page, "Zoom Out");
  await expect
    .poll(async () => zoomPercent(await zoomStatus(page).innerText()))
    .toBeLessThan(fitted);
  await editorTitleAction(page, "Fit Width");
  await expect(zoomStatus(page)).toHaveText(/^Fit Width/u);

  await editorTitleAction(page, "Find in PDF");
  await expect(
    viewer.getByRole("searchbox", { name: "Find in PDF" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  // Regions default off: Select Region is hidden; Copy link is clipboard Quote.
  await editorTitleAction(page, "Fit Page");
  await showPage(page, viewer, 1);
  await page.keyboard.press("F1");
  await page
    .locator(".quick-input-widget input:visible")
    .fill(">PDF: Select Region Tool");
  // Match the command's own label: VS Code adds a "similar commands" row
  // whose text carries the query.
  await expect(
    page
      .locator(".quick-input-list .monaco-list-row")
      .getByText("PDF: Select Region Tool", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  const at = await pagePoint(viewer, 1);
  await selectText(page, viewer, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await contextMenu(page, at(100, TEXT_MIDLINE), "Copy link to this");
  const quote = await pastedClipboard(page);
  expect(withoutSpaces(quote)).toContain(
    withoutSpaces(`[outline.pdf · p.1](${PDF}#page=1#:~:text=`),
  );
  expect(quote).not.toMatch(/viewrect=|#hl-/u);
});

test("keyboard shortcuts page, zoom, fit, find and pick the tool while the PDF has focus", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(statusBarEntry(page, /^Page 1 \/ 12$/u)).toBeVisible();
  await focusViewer(page, viewer, 1);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.keyboard.press("Alt+PageDown");
  await page.keyboard.press("Alt+PageDown");
  await expect(statusBarEntry(page, /^Page 3 \/ 12$/u)).toBeVisible();
  await page.keyboard.press("Alt+PageUp");
  await expect(statusBarEntry(page, /^Page 2 \/ 12$/u)).toBeVisible();

  await page.keyboard.press(`${modifier}+Alt+0`);
  await expect(zoomStatus(page)).toHaveText(/^Fit Page/u);
  const fitted = zoomPercent(await zoomStatus(page).innerText());
  await page.keyboard.press(`${modifier}+Equal`);
  await expect(zoomStatus(page)).toHaveText(/^\d+%$/u);
  expect(zoomPercent(await zoomStatus(page).innerText())).toBeGreaterThan(
    fitted,
  );
  await page.keyboard.press(`${modifier}+Minus`);
  await page.keyboard.press(`${modifier}+Minus`);
  await expect
    .poll(async () => zoomPercent(await zoomStatus(page).innerText()))
    .toBeLessThan(fitted);
  await page.keyboard.press(`${modifier}+0`);
  await expect(zoomStatus(page)).toHaveText(/^Fit Width/u);
  // The viewer scrolls to keep its place just after a zoom; a page asked
  // for meanwhile would be scrolled away from.
  await scrollSettled(viewer);

  await goToPage(page, viewer, 9, () => page.keyboard.press("Control+g"));
  await expect(statusBarEntry(page, /^Page 9 \/ 12$/u)).toBeVisible();

  await focusViewer(page, viewer, 9);
  // Regions default off: Select Region shortcut is unbound / no-ops.
  await page.keyboard.press(
    process.platform === "darwin" ? "Control+Meta+r" : "Control+Alt+r",
  );
  await expect.poll(() => tool(viewer)).toBe("text");

  await page.keyboard.press(`${modifier}+f`);
  await expect(
    viewer.getByRole("searchbox", { name: "Find in PDF" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
});

test("the toolbar setting takes the controls off the status bar and back, live", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  // The viewer has no bar of its own in VS Code, whatever the setting.
  const viewerBar = viewer.getByRole("toolbar", { name: "PDF toolbar" });
  await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  await expect(zoomStatus(page)).toBeVisible();
  try {
    await setToolbarMode(page, /None/u);
    await expect(statusBarEntry(page, PAGE_STATUS)).toHaveCount(0);
    await expect(zoomStatus(page)).toHaveCount(0);
    // The commands still work.
    await command(page, "PDF: Fit Page");
    await expect
      .poll(() =>
        viewer.evaluate(() => {
          const viewport = document.querySelector(".viewport")!;
          return (
            document
              .querySelector('.page[data-page-index="0"]')!
              .getBoundingClientRect().height <= viewport.clientHeight
          );
        }),
      )
      .toBe(true);
    // Checked once the viewer has answered a command: a bar the setting
    // brought would be drawn by then.
    await expect(viewerBar).toHaveCount(0);
  } finally {
    await setToolbarMode(page, /Status Bar/u);
  }
  await expect(statusBarEntry(page, PAGE_STATUS)).toBeVisible();
  await expect(zoomStatus(page)).toBeVisible();
  await expect(viewerBar).toHaveCount(0);
});
