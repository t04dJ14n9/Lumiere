import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { paths } from "./state";
import { pageFit } from "./pdf-geometry";
import {
  command,
  contextMenu,
  contextMenuLabels,
  drag,
  expect,
  fitPage,
  openFile,
  pageAtTop,
  pagePoint,
  pastedClipboard,
  pdfViewer,
  pointAtTop,
  selectText,
  showPage,
  statusBarEntry,
  test,
  withoutSpaces,
} from "./workbench";

// Exact Quote text is covered by test/unit/agent-text.test.ts; these tests
// check real VS Code menus, clipboard-only Copy link, and Open Location.

const PDF = "docs/outline.pdf";
const TEXT_MIDLINE = 94;

/** The "PDF Outline" view in the Explorer, expanded. */
async function outlineView(page: Page) {
  await command(page, "View: Show Explorer");
  const header = page.locator(".pane-header", { hasText: "PDF Outline" });
  await expect(header).toBeVisible();
  if ((await header.getAttribute("aria-expanded")) === "false") {
    await header.click();
  }
  return page.locator(".pane", { has: header });
}

test("a PDF opens with its outline in the Explorer, shown only while the PDF is active", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(statusBarEntry(page, /^Page 1 \/ 12$/u)).toBeVisible();

  const outline = await outlineView(page);
  for (const title of ["Part One", "Section 1.1", "Section 1.2", "Part Two"]) {
    await expect(
      outline.getByRole("treeitem", { name: new RegExp(title) }),
    ).toBeVisible();
  }
  // Follow Cursor's accordion: the part being read is open, the other closed.
  await expect(
    outline.getByRole("treeitem", { name: /Section 2\.1/ }),
  ).toHaveCount(0);
  await outline.getByRole("treeitem", { name: /Section 1\.2/ }).click();
  await expect.poll(() => pageAtTop(viewer, 3)).toBe(true);
  await outline
    .getByRole("treeitem", { name: /Part Two/ })
    .locator(".monaco-tl-twistie")
    .click();
  // "Section 2.1" points 130 points down page 9 (test/fixtures/make-fixtures.mjs).
  await outline.getByRole("treeitem", { name: /Section 2\.1/ }).click();
  await expect.poll(() => pointAtTop(viewer, 9, 130)).toBe(true);

  const header = page.locator(".pane-header", { hasText: "PDF Outline" });
  await openFile(page, "notes.md");
  await expect(header).toHaveCount(0);
  await page
    .locator(".tabs-container .tab", { hasText: "outline.pdf" })
    .click();
  await expect(header).toBeVisible();
});

test("Copy link to this is clipboard Quote / page link; no agent chat", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 3);

  const at = await pagePoint(viewer, 3);
  // Enabled whenever the PDF is active — including with nothing selected.
  const unselected = await contextMenuLabels(page, at(100, TEXT_MIDLINE));
  expect(unselected).toContain("Go to Page…");
  expect(unselected).toContain("Copy link to this");

  await contextMenu(page, at(100, TEXT_MIDLINE), "Copy link to this");
  const pageOnly = await pastedClipboard(page);
  expect(withoutSpaces(pageOnly)).toContain(
    withoutSpaces(`[outline.pdf · p.3](${PDF}#page=3)`),
  );
  expect(pageOnly).not.toMatch(/viewrect=|#:~:text=/u);

  await page
    .locator(".tabs-container .tab", { hasText: "outline.pdf" })
    .click();
  await expect(statusBarEntry(page, /^Page 3 \/ 12$/u)).toBeVisible();
  await selectText(page, viewer, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect(
    viewer.getByRole("toolbar", { name: "PDF text selection actions" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".editor-actions")
      .getByRole("button", { name: /^Copy link to this/u }),
  ).toHaveCount(0);

  await contextMenu(page, at(100, TEXT_MIDLINE), "Copy link to this");
  const quote = await pastedClipboard(page);
  expect(quote).toMatch(/^>/u);
  expect(withoutSpaces(quote)).toContain(
    withoutSpaces(`[outline.pdf · p.3](${PDF}#page=3#:~:text=`),
  );
  expect(quote).toMatch(/Synthetic%20page%203|Synthetic page 3/u);
  expect(quote).not.toMatch(/viewrect=|selection=|search=/u);

  // Regions default off: empty-page drag creates no region.
  await page
    .locator(".tabs-container .tab", { hasText: "outline.pdf" })
    .click();
  await expect
    .poll(() => pageFit(viewer))
    .toEqual({ fitsWidth: true, fitsHeight: true, fills: true });
  const refit = await pagePoint(viewer, 3);
  await drag(page, refit(150, 150), refit(250, 250));
  await expect(viewer.locator(".region-selection")).toHaveCount(0);
  await expect(
    viewer.getByRole("toolbar", { name: "PDF region actions" }),
  ).toHaveCount(0);

  await page.keyboard.press("F1");
  await page
    .locator(".quick-input-widget input:visible")
    .fill(">PDF: Copy for Agent");
  await expect(
    page.locator(".quick-input-list .monaco-list-row", {
      hasText: "Copy for Agent",
    }),
  ).toHaveCount(0);
  await page
    .locator(".quick-input-widget input:visible")
    .fill(">PDF: Ask Agent");
  await expect(
    page.locator(".quick-input-list .monaco-list-row", {
      hasText: "Ask Agent",
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("PDF: Open Location opens a pasted link at its page and flashes its box", async ({
  workbench: page,
}) => {
  await command(page, "PDF: Open Location…");
  const input = page.locator(".quick-input-widget input:visible");
  // Legacy viewrect still opens; new Copy link prefers #:~:text=.
  await input.fill(`[outline.pdf · p.5](${PDF}#page=5&viewrect=72,83,134,21)`);
  await input.press("Enter");
  const viewer = await pdfViewer(page);
  await expect(
    viewer.locator('.page[data-page-index="4"] .location-highlight'),
  ).toBeVisible();
  await expect(statusBarEntry(page, /^Page 5 \/ 12$/u)).toBeVisible();
});

test("the viewer reloads when the PDF changes on disk", async ({
  workbench: page,
}) => {
  const changing = path.join(paths.workspace, "docs", "changing.pdf");
  copyFileSync(path.join(paths.fixtures, "outline.pdf"), changing);
  await openFile(page, "docs/changing.pdf");
  await pdfViewer(page);
  await expect(statusBarEntry(page, /^Page 1 \/ 12$/u)).toBeVisible();
  const outline = await outlineView(page);
  await expect(
    outline.getByRole("treeitem", { name: /Part One/ }),
  ).toBeVisible();

  copyFileSync(path.join(paths.fixtures, "short.pdf"), changing);
  await expect(statusBarEntry(page, /^Page 1 \/ 3$/u)).toBeVisible();
  await expect(outline.getByText("This PDF has no outline.")).toBeVisible();
});

test("the agent bridge is off by default, and its setting starts and stops it", async ({
  workbench: page,
}) => {
  // The bridge starts a local MCP server, so it is opt-in (lumiere.pdf.agentBridge.enabled).
  // A running bridge announces itself with a file in ~/.agent-pdf-viewer/bridges.
  const bridges = path.join(paths.home, ".agent-pdf-viewer", "bridges");
  const announced = (): number =>
    existsSync(bridges)
      ? readdirSync(bridges).filter((name) => name.endsWith(".json")).length
      : 0;
  await openFile(page, PDF);
  await pdfViewer(page);
  expect(announced()).toBe(0);

  // Copy MCP Setup offers to turn it on.
  await command(page, "PDF: Copy MCP Setup for Claude Code / Codex…");
  const offer = page
    .locator(".notification-toast")
    .filter({ hasText: "The agent bridge is off." });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Turn On" }).click();
  await expect.poll(announced, { timeout: 15_000 }).toBe(1);
  await expect(page.locator(".quick-input-widget")).toBeVisible();
  await page.keyboard.press("Escape");

  // Turning the setting off stops the server, without a reload.
  const settingsFile = path.join(paths.userData, "User", "settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as Record<
    string,
    unknown
  >;
  expect(settings["lumiere.pdf.agentBridge.enabled"]).toBe(true);
  writeFileSync(
    settingsFile,
    JSON.stringify(
      { ...settings, "lumiere.pdf.agentBridge.enabled": false },
      null,
      2,
    ),
  );
  await expect.poll(announced, { timeout: 15_000 }).toBe(0);
});
