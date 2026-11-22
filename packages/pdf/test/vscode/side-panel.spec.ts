import { chromium, type Browser, type Page } from "@playwright/test";
import { readState } from "./state";
import {
  command,
  editorTitleAction,
  expect,
  inCursor,
  openFile,
  pageAtTop,
  pdfViewer,
  test,
} from "./workbench";

/**
 * Host GUI: the in-viewer side panel (#867). A PDF moved into a floating
 * window (View: Move Editor into New Window) has no side bar, so the PDF
 * Outline in the Explorer is out of reach; the panel inside the viewer goes
 * with it. It is hidden at first, turned on from the editor title button or
 * Toggle Side Panel, and its Outline tab takes the viewer to a place.
 * Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";

test.setTimeout(120_000);

interface FloatingWindow {
  window: Page;
  browser: Browser;
}

/**
 * The window the PDF was moved to. It is another window of the same VS Code,
 * so another page of the same browser: the one with a PDF viewer in it and no
 * side bar. The main window is told by its side bar, which it keeps in the
 * page even while it is hidden, and which a window for editors alone lacks:
 * until VS Code has torn the old editor down, the main window may still hold
 * the viewer for a moment.
 */
async function floatingWindow(): Promise<FloatingWindow> {
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    let found: Page | undefined;
    await expect
      .poll(
        async () => {
          for (const page of browser.contexts().flatMap((c) => c.pages())) {
            if (await page.locator(".part.sidebar").count()) {
              continue;
            }
            for (const frame of page.frames()) {
              if (
                await frame
                  .locator(".viewer .page")
                  .count()
                  .catch(() => 0)
              ) {
                found = page;
                return true;
              }
            }
          }
          return false;
        },
        { message: "The PDF did not appear in a window of its own" },
      )
      .toBe(true);
    return { window: found!, browser };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Close the floating window by closing its last editor, whatever state the test left it in. */
async function closeFloatingWindow(
  floating: FloatingWindow | undefined,
): Promise<void> {
  if (!floating) {
    return;
  }
  try {
    if (!floating.window.isClosed()) {
      await floating.window.bringToFront();
      await floating.window.keyboard.press("ControlOrMeta+w");
      await expect.poll(() => floating.window.isClosed()).toBe(true);
    }
  } finally {
    await floating.browser.close();
  }
}

/**
 * Leave the side panel closed as the last choice, which every PDF opened
 * later starts from: a spec that failed with it open must not give the specs
 * after it a panel they do not expect.
 */
async function leavePanelClosed(page: Page): Promise<void> {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  if (await viewer.locator(".side-panel").count()) {
    await command(page, "PDF: Toggle Side Panel");
    await expect(viewer.locator(".side-panel")).toHaveCount(0);
  }
}

test("a PDF in a floating window has no side bar, and the viewer's side panel stands in for it", async ({
  workbench: page,
}) => {
  test.skip(inCursor, "Cursor draws the editor title menu natively");
  let floating: FloatingWindow | undefined;
  try {
    await openFile(page, PDF);
    const viewer = await pdfViewer(page);

    // Hidden until asked for; the title button says what it would do.
    await expect(viewer.locator(".side-panel")).toHaveCount(0);
    const actions = page.locator(".editor-actions");
    await expect(
      actions.getByRole("button", { name: "Show Side Panel" }),
    ).toBeVisible();
    await editorTitleAction(page, "Show Side Panel");
    await expect(viewer.locator(".side-panel")).toBeVisible();
    // It is a toggle: the button now offers to hide it, and does.
    await expect(
      actions.getByRole("button", { name: "Hide Side Panel" }),
    ).toBeVisible();
    await expect(
      actions.getByRole("button", { name: "Show Side Panel" }),
    ).toHaveCount(0);
    await editorTitleAction(page, "Hide Side Panel");
    await expect(viewer.locator(".side-panel")).toHaveCount(0);
    await command(page, "PDF: Toggle Side Panel");
    await expect(viewer.locator(".side-panel")).toBeVisible();

    // Into a window of its own: no side bar there, and the panel came along.
    await command(page, "View: Move Editor into New Window");
    floating = await floatingWindow();
    const { window: aux } = floating;
    await expect(aux.locator(".part.sidebar")).toHaveCount(0);
    const moved = await pdfViewer(aux);
    await expect(moved.locator(".side-panel")).toBeVisible();

    // The editor title of the floating window has the button too: it hides
    // and shows the panel there, wherever the title bar keeps it.
    await editorTitleAction(aux, "Hide Side Panel");
    await expect(moved.locator(".side-panel")).toHaveCount(0);
    await editorTitleAction(aux, "Show Side Panel");
    await expect(moved.locator(".side-panel")).toBeVisible();

    // The Outline tab takes the viewer to a place.
    await moved.getByRole("tab", { name: "Outline", exact: true }).click();
    const outline = moved.getByRole("tree", { name: "Outline" });
    await expect(
      outline.getByRole("treeitem", { name: /^Part One/u }),
    ).toBeVisible();
    await outline.getByRole("treeitem", { name: /^Section 1\.2/u }).click();
    await expect.poll(() => pageAtTop(moved, 3)).toBe(true);
    // Its Follow Cursor selects the bookmark the reader is at, as the Explorer does.
    await expect(
      outline.getByRole("treeitem", { name: /^Section 1\.2/u }),
    ).toHaveAttribute("aria-selected", "true");

    // Each tab opens; a click on a thumbnail goes to its page.
    await moved.getByRole("tab", { name: "Thumbnails", exact: true }).click();
    const pages = moved.getByRole("listbox", { name: "Thumbnails" });
    await expect(
      pages.getByRole("option", { name: "Page 4" }).locator("img"),
    ).toBeVisible();
    await pages.getByRole("option", { name: "Page 4" }).click();
    await expect.poll(() => pageAtTop(moved, 4)).toBe(true);
    await moved.getByRole("tab", { name: "Bookmarks", exact: true }).click();
    await expect(moved.getByRole("tabpanel")).toContainText("Bookmarks");
    await moved.getByRole("tab", { name: "Annotations", exact: true }).click();
    await expect(moved.getByRole("tabpanel")).toContainText("Annotations");

    // Toggle Side Panel works from the floating window's own palette too.
    await command(aux, "PDF: Toggle Side Panel");
    await expect(moved.locator(".side-panel")).toHaveCount(0);
  } finally {
    await closeFloatingWindow(floating);
    await leavePanelClosed(page);
  }
});
