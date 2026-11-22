import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { paths } from "./state";
import {
  command,
  expect,
  focusViewer,
  openFile,
  pageAtTop,
  pdfViewer,
  pointAtTop,
  quickInputTitled,
  showPage,
  test,
} from "./workbench";

/**
 * Host GUI: bookmarks are the reader's own named places. Add Bookmark keeps
 * the place (and a title that defaults to the outline section) in a file beside
 * the PDF's annotation file, named by the PDF's hash; the PDF Bookmarks view in
 * the Explorer and Go to Bookmark… return to it, and the Quick Pick's item
 * buttons rename and delete. Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";

test.setTimeout(120_000);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

type Kept = {
  version: number;
  bookmarks: {
    title: string;
    page: number;
    position: { top: number; left: number };
  }[];
};

function keptBookmarks(file: string): Kept["bookmarks"] {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Kept).bookmarks
    : [];
}

/** A PDF view in the Explorer, expanded. */
async function explorerView(page: Page, name: "PDF Outline" | "PDF Bookmarks") {
  await command(page, "View: Show Explorer");
  const header = page.locator(".pane-header", { hasText: name });
  await expect(header).toBeVisible();
  if ((await header.getAttribute("aria-expanded")) === "false") {
    await header.click();
  }
  return page.locator(".pane", { has: header });
}

/** The rows of the Go to Bookmark… Quick Pick. */
const quickPickRows = (page: Page) =>
  page.locator(
    ".quick-input-widget:visible .quick-input-list .monaco-list-row",
  );

test("Add Bookmark keeps a place beside the PDF; the view and Go to Bookmark… return to it, and the PDF is never written", async ({
  workbench: page,
}) => {
  const pdfPath = path.join(paths.workspace, PDF);
  const pdfHash = sha256(pdfPath);
  const pdfBefore = readFileSync(pdfPath);
  const kept = path.join(
    paths.workspace,
    ".lumiere",
    "pdf-annotations",
    `${pdfHash}.bookmarks.json`,
  );
  rmSync(kept, { force: true });
  try {
    await openFile(page, PDF);
    const viewer = await pdfViewer(page);
    await expect(viewer.locator(".page img").first()).toBeVisible();

    // Nothing yet: the Explorer view offers to add one.
    const view = await explorerView(page, "PDF Bookmarks");
    await expect(view).toContainText("No bookmarks yet.");
    await expect(
      view.getByRole("button", { name: "Add Bookmark" }).first(),
    ).toBeVisible();

    // "Section 2.1" opens 130 points down page 9: the place that is kept.
    const outline = await explorerView(page, "PDF Outline");
    await outline
      .getByRole("treeitem", { name: /Part Two/ })
      .locator(".monaco-tl-twistie")
      .click();
    await outline.getByRole("treeitem", { name: /Section 2\.1/ }).click();
    await expect.poll(() => pointAtTop(viewer, 9, 130)).toBe(true);

    await command(page, "PDF: Add Bookmark");
    const title = quickInputTitled(page, /^Add Bookmark/u);
    // The section the place is in; Enter would keep it, a typed title replaces it.
    await expect(title).toHaveValue("Section 2.1");
    await title.fill("Where I stopped");
    await title.press("Enter");
    await expect.poll(() => existsSync(kept), { timeout: 20_000 }).toBe(true);
    const file = JSON.parse(readFileSync(kept, "utf8")) as Kept;
    expect(file.version).toBe(1);
    expect(file.bookmarks).toHaveLength(1);
    expect(file.bookmarks[0]?.title).toBe("Where I stopped");
    expect(file.bookmarks[0]?.page).toBe(9);
    expect(file.bookmarks[0]?.position.top).toBeCloseTo(130, 0);

    // The Explorer view lists it, and a click goes back to the same spot.
    const row = bookmarksRow(view, "Where I stopped");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Page 9");
    await showPage(page, viewer, 1);
    await row.click();
    await expect.poll(() => pointAtTop(viewer, 9, 130)).toBe(true);

    // The shortcut (Preview's Cmd+D) adds one too; Enter keeps the offered title.
    await showPage(page, viewer, 2);
    await focusViewer(page, viewer);
    await page.keyboard.press("ControlOrMeta+D");
    const offered = quickInputTitled(page, /^Add Bookmark/u);
    await expect(offered).toHaveValue("Section 1.1");
    await offered.press("Enter");
    await expect(bookmarksRow(view, "Section 1.1")).toBeVisible();
    await expect
      .poll(() => keptBookmarks(kept).map((b) => b.title))
      .toEqual(["Section 1.1", "Where I stopped"]);

    // Go to Bookmark… is a deliberate jump: Back returns to where it left.
    await showPage(page, viewer, 1);
    await command(page, "PDF: Go to Bookmark…");
    const search = quickInputTitled(page, /^Go to Bookmark/u);
    await expect(search).toBeVisible();
    await expect(quickPickRows(page)).toHaveCount(2);
    await expect(quickPickRows(page).first()).toContainText("Section 1.1");
    await expect(quickPickRows(page).last()).toContainText(
      "Page 9 · Section 2.1",
    );
    await search.fill("stopped");
    await expect(quickPickRows(page)).toHaveCount(1);
    await search.press("Enter");
    await expect.poll(() => pointAtTop(viewer, 9, 130)).toBe(true);
    await command(page, "PDF: Back to Previous Location");
    await expect.poll(() => pageAtTop(viewer, 1)).toBe(true);

    // The item buttons rename (the title is asked for, and the Quick Pick
    // comes back) and delete (the Quick Pick stays open on the rest).
    await command(page, "PDF: Go to Bookmark…");
    await expect(quickPickRows(page)).toHaveCount(2);
    await quickPickRows(page).last().hover();
    await quickPickRows(page)
      .last()
      .locator('[aria-label="Rename Bookmark"]')
      .click();
    const rename = quickInputTitled(page, /^Rename Bookmark/u);
    await expect(rename).toHaveValue("Where I stopped");
    await rename.fill("Chapter to revisit");
    await rename.press("Enter");
    await expect(quickPickRows(page)).toHaveCount(2);
    await expect(quickPickRows(page).last()).toContainText(
      "Chapter to revisit",
    );
    await quickPickRows(page).first().hover();
    await quickPickRows(page)
      .first()
      .locator('[aria-label="Delete Bookmark"]')
      .click();
    await expect(quickPickRows(page)).toHaveCount(1);
    await expect
      .poll(() => keptBookmarks(kept).map((b) => b.title))
      .toEqual(["Chapter to revisit"]);
    await page.keyboard.press("Escape");

    // The rows' own buttons do the same in the Explorer.
    const renamed = bookmarksRow(view, "Chapter to revisit");
    await renamed.hover();
    // A row's button carries its command's title, which ends in an ellipsis;
    // the Quick Pick's button carries its own tooltip.
    await renamed.locator('[aria-label="Rename Bookmark…"]').click();
    const inView = quickInputTitled(page, /^Rename Bookmark/u);
    await inView.fill("Final");
    await inView.press("Enter");
    const final = bookmarksRow(view, "Final");
    await expect(final).toBeVisible();
    await final.hover();
    await final.locator('[aria-label="Delete Bookmark"]').click();
    await expect(view).toContainText("No bookmarks yet.");
    await expect.poll(() => existsSync(kept)).toBe(false);

    // Bookmarks are beside the PDF, never in it.
    expect(readFileSync(pdfPath).equals(pdfBefore)).toBe(true);
    expect(sha256(pdfPath)).toBe(pdfHash);
  } finally {
    rmSync(kept, { force: true });
  }
});

function bookmarksRow(view: ReturnType<Page["locator"]>, title: string) {
  return view.getByRole("treeitem", { name: new RegExp(title) });
}
