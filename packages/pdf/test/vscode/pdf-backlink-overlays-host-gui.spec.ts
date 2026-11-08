import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { pageFit, type Point } from "./pdf-geometry";
import { paths } from "./state";
import {
  command,
  drag,
  expect,
  fitPage,
  openFile,
  pagePoint,
  pastedClipboard,
  pdfViewer,
  selectText,
  showPage,
  statusBarEntry,
  test,
  withoutSpaces,
} from "./workbench";

/**
 * Host GUI evidence for docs/host-gui/pdf-backlink-overlays-checklist.md.
 * Synthetic fixtures only (outline.pdf). Screenshots stay under test-results/
 * (do not commit PNGs).
 *
 * Copy link uses the DOM context menu Cursor draws under xvfb
 * (`window.menuStyle: custom`). The native-menu CDP helper hangs here, and the
 * enablement-gated palette command disappears once the palette steals PDF
 * focus.
 */
const PDF = "docs/outline.pdf";
const NOTE = "vault-backlink.md";
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(
  paths.repository,
  "test-results",
  "host-gui-pdf-backlink-overlays",
);
// This checklist collects evidence for the PR bot, which runs Cursor under
// xvfb and names where the evidence goes. Elsewhere its DOM-menu and clipboard
// steps do not hold, and a failure midway leaves editors open that every later
// spec trips over, so it runs only when that place is given.
const EVIDENCE_DIR = process.env.LUMIERE_HOST_GUI_EVIDENCE_DIR ?? "";
test.skip(
  !EVIDENCE_DIR,
  "PR-bot evidence run: set LUMIERE_HOST_GUI_EVIDENCE_DIR to run it",
);
const SHOT_COPY_DIR = path.join(EVIDENCE_DIR, "host-gui-shots");

test.setTimeout(480_000);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

function vaultNoteMarkdown(): string {
  return [
    "# Vault backlink note",
    "",
    `See [outline · p.1](${PDF}#page=1#:~:text=Synthetic%20page%201) for the quote.`,
    "",
  ].join("\n");
}

async function shot(
  page: Page,
  name: string,
  evidence: string[],
): Promise<string> {
  const dest = path.join(SHOT_DIR, name);
  // Viewport-only: fullPage screenshots have hung under Cursor+xvfb mid-run.
  await page.screenshot({ path: dest, timeout: 15_000 });
  mkdirSync(SHOT_COPY_DIR, { recursive: true });
  copyFileSync(dest, path.join(SHOT_COPY_DIR, name));
  evidence.push(`shot=${dest}`);
  return dest;
}

function flushEvidence(
  results: Array<{
    item: number;
    title: string;
    status: "PASS" | "FAIL" | "GAP";
    notes: string;
  }>,
  evidence: string[],
  pageOnly: string,
  quote: string,
): void {
  const lines: string[] = [
    "# Host GUI evidence — PDF backlink overlays (Chrome)",
    "",
    `- **When (Asia/Singapore):** ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} Asia/Singapore`,
    `- **Worktree:** \`${paths.repository}\``,
    `- **Host:** Cursor + xvfb`,
    `- **Fixture:** \`${PDF}\``,
    "",
    "## Checklist",
    "",
    "| # | Item | Result | Notes |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of [...results].sort((a, b) => a.item - b.item)) {
    lines.push(
      `| ${row.item} | ${row.title} | **${row.status}** | ${row.notes.replace(/\|/gu, "\\|")} |`,
    );
  }
  lines.push(
    "",
    "## Screenshots",
    "",
    ...[
      "01-Copy-link-Quote.png",
      "02-regions-off.png",
      "03-overlays.png",
      "04-Del-split.png",
    ].map((name) => {
      const abs = path.join(SHOT_DIR, name);
      return `- \`${abs}\`${existsSync(abs) ? "" : " (missing)"}`;
    }),
    "",
    "## Clipboard",
    "",
    "### No selection",
    "```",
    pageOnly.trim() || "(empty)",
    "```",
    "",
    "### Quote",
    "```",
    quote.trim() || "(empty)",
    "```",
    "",
    "## Raw",
    "",
    "```",
    ...evidence,
    "```",
    "",
  );
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, "host-gui-evidence.md"),
    lines.join("\n"),
  );
  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    [
      ...evidence,
      ...results.map((r) => `item${r.item}=${r.status} ${r.notes}`),
      "",
    ].join("\n"),
  );
}

async function openDomContextMenu(
  page: Page,
  at: Point,
  opts: { preserveSelection?: boolean } = {},
): Promise<void> {
  const item = page
    .locator(".monaco-menu")
    .getByRole("menuitem", { name: "Copy link to this" });
  await expect(async () => {
    if (await page.locator(".monaco-menu").count()) {
      await page.keyboard.press("Escape");
      await expect(page.locator(".monaco-menu")).toHaveCount(0);
    }
    // Nudge into the page so the webview owns the pointer before right-click.
    await page.mouse.move(at.screen[0], at.screen[1]);
    // A left click clears text selection — skip it when Copy link must see a quote.
    if (!opts.preserveSelection) {
      await page.mouse.click(...at.screen, { button: "left" });
    }
    await page.mouse.click(...at.screen, { button: "right" });
    await expect(item).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

async function chooseDomCopyLink(page: Page): Promise<void> {
  const item = page
    .locator(".monaco-menu")
    .getByRole("menuitem", { name: "Copy link to this" });
  await item.hover();
  // Menu actions run on mouseup after enter; Enter on the focused row is
  // more reliable under xvfb than a synthetic click.
  await page.keyboard.press("Enter");
  await expect(page.locator(".monaco-menu")).toHaveCount(0, { timeout: 5_000 });
}

async function copyLinkViaDomMenu(page: Page, at: Point): Promise<string> {
  await openDomContextMenu(page, at);
  await chooseDomCopyLink(page);
  // Command handler is fire-and-forget from the menu; wait for clipboard.
  await page.waitForTimeout(750);
  return pastedClipboard(page);
}

async function domContextMenuLabels(page: Page, at: Point): Promise<string[]> {
  await openDomContextMenu(page, at);
  const items = page.locator(".monaco-menu").getByRole("menuitem");
  const names = await items.evaluateAll((elements) =>
    elements.map(
      (element) =>
        element.querySelector(".action-label")?.textContent?.trim() ?? "",
    ),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".monaco-menu")).toHaveCount(0);
  return names;
}

test("Host GUI: PDF backlink overlays checklist (Chrome)", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(SHOT_COPY_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const notePath = path.join(paths.workspace, NOTE);
  const results: Array<{
    item: number;
    title: string;
    status: "PASS" | "FAIL" | "GAP";
    notes: string;
  }> = [];
  const evidence: string[] = [
    `pdf=${PDF}`,
    `host=cursor`,
    `when=${new Date().toISOString()}`,
  ];

  await openFile(page, PDF);
  let viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);

  const at1 = await pagePoint(viewer, 1);
  const menuLabels = await domContextMenuLabels(page, at1(100, TEXT_MIDLINE));
  evidence.push(`context_menu_labels=${JSON.stringify(menuLabels)}`);
  expect(menuLabels).toContain("Copy link to this");

  const pageOnly = await copyLinkViaDomMenu(page, at1(100, TEXT_MIDLINE));
  evidence.push(`clipboard_no_selection=${JSON.stringify(pageOnly)}`);
  const pageOnlyOk =
    withoutSpaces(pageOnly).includes(
      withoutSpaces(`[outline.pdf · p.1](${PDF}#page=1)`),
    ) && !/#:~:text=|viewrect=/u.test(pageOnly);
  results.push({
    item: 2,
    title: "No selection → Copy link → #page=N only",
    status: pageOnlyOk ? "PASS" : "FAIL",
    notes: pageOnlyOk
      ? "clipboard has #page=1 only (DOM context menu)"
      : `unexpected clipboard: ${pageOnly}`,
  });

  await page
    .locator(".tabs-container .tab", { hasText: "outline.pdf" })
    .click();
  await expect(statusBarEntry(page, /^Page 1 \/ 12$/u)).toBeVisible();
  viewer = await pdfViewer(page);
  await expect
    .poll(() => pageFit(viewer))
    .toEqual({ fitsWidth: true, fitsHeight: true, fills: true });
  const atQuote = await pagePoint(viewer, 1);
  await selectText(
    page,
    viewer,
    atQuote(74, TEXT_MIDLINE),
    atQuote(205, TEXT_MIDLINE),
  );
  // Do not left-click first — that clears the selection before Copy link runs.
  await openDomContextMenu(page, atQuote(140, TEXT_MIDLINE), {
    preserveSelection: true,
  });
  await shot(page, "01-Copy-link-Quote.png", evidence);
  await chooseDomCopyLink(page);
  await page.waitForTimeout(750);
  let quote = await pastedClipboard(page);
  if (!/#:~:text=/u.test(quote)) {
    // Retry once: selection can drop if the menu opens off the glyph run.
    await page
      .locator(".tabs-container .tab", { hasText: "outline.pdf" })
      .click();
    viewer = await pdfViewer(page);
    const atRetry = await pagePoint(viewer, 1);
    await selectText(
      page,
      viewer,
      atRetry(74, TEXT_MIDLINE),
      atRetry(205, TEXT_MIDLINE),
    );
    await openDomContextMenu(page, atRetry(140, TEXT_MIDLINE), {
      preserveSelection: true,
    });
    await chooseDomCopyLink(page);
    await page.waitForTimeout(750);
    quote = await pastedClipboard(page);
  }
  evidence.push(`clipboard_quote=${JSON.stringify(quote)}`);
  const hasPageAndText =
    quote.trimStart().startsWith(">") &&
    withoutSpaces(quote).includes(
      withoutSpaces(`[outline.pdf · p.1](${PDF}#page=1#:~:text=`),
    ) &&
    /Synthetic(%20| )page(%20| )1/u.test(quote) &&
    !/viewrect=|selection=|search=/u.test(quote);
  const hasDashEncoding = /%2D/u.test(quote);
  results.push({
    item: 1,
    title: "Text select → Copy link → Quote #page= + #:~:text= (dashes %2D)",
    status: hasPageAndText ? (hasDashEncoding ? "PASS" : "GAP") : "FAIL",
    notes: hasPageAndText
      ? hasDashEncoding
        ? "quote has page+text and %2D"
        : "quote has #page= + #:~:text= (spaces %20); fixture text has no hyphen so %2D not observed — unit encodeTextFragment covers %2D"
      : `unexpected clipboard: ${quote}`,
  });

  await page
    .locator(".tabs-container .tab", { hasText: "outline.pdf" })
    .click();
  viewer = await pdfViewer(page);
  await expect
    .poll(() => pageFit(viewer))
    .toEqual({ fitsWidth: true, fitsHeight: true, fills: true });
  const atRegion = await pagePoint(viewer, 1);
  await drag(page, atRegion(150, 150), atRegion(250, 250));
  const regionCount = await viewer.locator(".region-selection").count();
  await page.keyboard.press("F1");
  await page
    .locator(".quick-input-widget input:visible")
    .fill(">PDF: Select Region Tool");
  const selectRegionRows = await page
    .locator(".quick-input-list .monaco-list-row", {
      hasText: "Select Region Tool",
    })
    .count();
  await page.keyboard.press("Escape");
  const regionsOk = regionCount === 0 && selectRegionRows === 0;
  results.push({
    item: 5,
    title: "Regions off default: empty-page drag noop; Select Region absent",
    status: regionsOk ? "PASS" : "FAIL",
    notes: `region_selection=${regionCount} select_region_rows=${selectRegionRows}`,
  });
  await shot(page, "02-regions-off.png", evidence);
  flushEvidence(results, evidence, pageOnly, quote);

  // Seed the vault note only after Copy-link / regions shots so overlays do
  // not steal the text cursor during selectText. Disk write + tiny dirty/save
  // so onDidSave refreshes the backlink index (startup idleScan already finished).
  evidence.push(`seeded_note=${NOTE}`);
  writeFileSync(notePath, vaultNoteMarkdown());
  try {
    await openFile(page, NOTE);
    await page.locator(".editor-instance .monaco-editor").first().click({
      timeout: 10_000,
    });
    // Tiny dirty so Ctrl+S emits onDidSaveTextDocument.
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(
        () => {
          try {
            return readFileSync(notePath, "utf8");
          } catch {
            return "";
          }
        },
        { timeout: 15_000 },
      )
      .toContain("#:~:text=Synthetic");
    evidence.push("note_saved=true");
  } catch (error) {
    evidence.push(`note_seed_error=${String(error)}`);
  }
  flushEvidence(results, evidence, pageOnly, quote);
  try {
    await command(page, "View: Close All Editor Groups");
  } catch (error) {
    evidence.push(`close_all_error=${String(error)}`);
    await page.keyboard.press("Escape");
  }
  await openFile(page, PDF);
  viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  // Poll for overlays: index push + glyph resolve can lag after save.
  // Soft wait so a miss still reaches the Del shot for evidence.
  for (
    let i = 0;
    i < 40 &&
    (await viewer.locator(".pdf-backlink-overlay-line").count()) === 0;
    i++
  ) {
    await page.waitForTimeout(500);
  }
  const overlayLine = viewer.locator(".pdf-backlink-overlay-line").first();
  evidence.push(
    `overlay_count_before_assert=${await viewer.locator(".pdf-backlink-overlay-line").count()}`,
  );
  flushEvidence(results, evidence, pageOnly, quote);
  let overlayOk = false;
  let clickOpensNote = false;
  let hoverTitle = "";
  try {
    await expect(overlayLine).toBeVisible({ timeout: 15_000 });
    const overlay = viewer.locator(".pdf-backlink-overlay").first();
    hoverTitle =
      (await overlay.getAttribute("title", { timeout: 5_000 })) ?? "";
    // Shot before hover/click: those actions have hung under xvfb with no
    // actionTimeout; force+timeout keeps the run moving and still yields 03.
    await shot(page, "03-overlays.png", evidence);
    await overlayLine.hover({ force: true, timeout: 8_000 });
    await page.waitForTimeout(300);
    await shot(page, "03-overlays.png", evidence);
    await overlayLine.click({ force: true, timeout: 8_000 });
    await expect(
      page.locator(".tabs-container .tab", { hasText: NOTE }),
    ).toBeVisible({ timeout: 15_000 });
    clickOpensNote = true;
    overlayOk = true;
  } catch (error) {
    evidence.push(`overlay_error=${String(error)}`);
    try {
      await shot(page, "03-overlays.png", evidence);
    } catch (shotError) {
      evidence.push(`overlay_shot_error=${String(shotError)}`);
    }
  }
  results.push({
    item: 3,
    title:
      "Note with deep link → open PDF → overlay → hover → click opens note",
    status: overlayOk && clickOpensNote ? "PASS" : "FAIL",
    notes: `title=${hoverTitle} overlay=${overlayOk} clickOpensNote=${clickOpensNote}`,
  });
  flushEvidence(results, evidence, pageOnly, quote);

  // Return to the PDF before Del / Annotate (click may have opened the note).
  try {
    await page
      .locator(".tabs-container .tab", { hasText: "outline.pdf" })
      .click({ timeout: 10_000 });
  } catch (error) {
    evidence.push(`return_pdf_error=${String(error)}`);
  }
  viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  let delOverlayNoop = false;
  let delEmbeddedOk = false;
  const pdfPath = path.join(paths.workspace, PDF);
  try {
    await expect(
      viewer.locator(".pdf-backlink-overlay-line").first(),
    ).toBeVisible({ timeout: 10_000 });
    const beforeOverlay = await viewer
      .locator(".pdf-backlink-overlay-line")
      .count();
    // Hover only — a click opens the note and steals focus; Del-on-overlay
    // means Delete while the pointer is on a vault overlay must not remove it.
    await viewer
      .locator(".pdf-backlink-overlay-line")
      .first()
      .hover({ force: true, timeout: 8_000 });
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    const afterOverlay = await viewer
      .locator(".pdf-backlink-overlay-line")
      .count();
    delOverlayNoop = afterOverlay === beforeOverlay && beforeOverlay > 0;
    evidence.push(`del_overlay_before=${beforeOverlay} after=${afterOverlay}`);

    await statusBarButton(page, "annotate").click({ timeout: 10_000 });
    await expect(statusBarButton(page, "annotate")).toContainText(
      /Annotating/u,
      { timeout: 10_000 },
    );
    const beforeHash = sha256(pdfPath);
    // Second line (~110pt) avoids the backlink overlay on "Synthetic page 1".
    const atDel = await pagePoint(viewer, 1);
    await drag(page, atDel(74, 110), atDel(180, 110));
    await expect
      .poll(() => sha256(pdfPath), { timeout: 20_000 })
      .not.toBe(beforeHash);
    const afterCreate = sha256(pdfPath);
    evidence.push(`sha256_after_highlight=${afterCreate}`);
    await page.mouse.click(...atDel(100, 110).screen);
    await page.waitForTimeout(200);
    await page.keyboard.press("Delete");
    await expect
      .poll(() => sha256(pdfPath), { timeout: 20_000 })
      .not.toBe(afterCreate);
    delEmbeddedOk = true;
  } catch (error) {
    evidence.push(`del_split_error=${String(error)}`);
  }
  try {
    await page
      .locator(".tabs-container .tab", { hasText: "outline.pdf" })
      .click({ timeout: 5_000 });
  } catch {
    // ignore
  }
  try {
    await shot(page, "04-Del-split.png", evidence);
  } catch (error) {
    evidence.push(`del_shot_error=${String(error)}`);
  }
  results.push({
    item: 4,
    title: "Del on overlay no-op; Del on Note/freeText (embedded) deletes",
    status: delOverlayNoop && delEmbeddedOk ? "PASS" : "FAIL",
    notes: `overlay_noop=${delOverlayNoop} embedded_highlight_delete=${delEmbeddedOk} (highlight used as embedded proxy for Note/freeText deleteSelected path)`,
  });
  flushEvidence(results, evidence, pageOnly, quote);

  try {
    if (
      /Annotating/u.test(
        (await statusBarButton(page, "annotate").innerText()).replace(
          /\s+/gu,
          " ",
        ),
      )
    ) {
      await statusBarButton(page, "annotate").click();
    }
  } catch {
    // ignore
  }

  const lines: string[] = [
    "# Host GUI evidence — PDF backlink overlays (Chrome)",
    "",
    `- **When (Asia/Singapore):** ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} Asia/Singapore`,
    `- **Worktree:** \`${paths.repository}\``,
    `- **Host:** Cursor (\`VSCODE_EXECUTABLE\`) + xvfb`,
    `- **Fixture:** \`${PDF}\` (synthetic)`,
    "- **Copy link path:** DOM context menu `Copy link to this` (avoids native-menu CDP hang under xvfb)",
    "",
    "## Checklist",
    "",
    "| # | Item | Result | Notes |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of results.sort((a, b) => a.item - b.item)) {
    lines.push(
      `| ${row.item} | ${row.title} | **${row.status}** | ${row.notes.replace(/\|/gu, "\\|")} |`,
    );
  }
  lines.push(
    "",
    "## Screenshots (absolute paths)",
    "",
    ...[
      "01-Copy-link-Quote.png",
      "02-regions-off.png",
      "03-overlays.png",
      "04-Del-split.png",
    ].map((name) => {
      const abs = path.join(SHOT_DIR, name);
      const copy = path.join(SHOT_COPY_DIR, name);
      return `- \`${abs}\`${existsSync(copy) ? ` (copy: \`${copy}\`)` : " (missing)"}`;
    }),
    "",
    "## Clipboard excerpts",
    "",
    "### No selection (item 2)",
    "```",
    pageOnly.trim(),
    "```",
    "",
    "### Text selection Quote (item 1)",
    "```",
    quote.trim(),
    "```",
    "",
    "## Raw evidence",
    "",
    "```",
    ...evidence,
    "```",
    "",
  );
  writeFileSync(
    path.join(EVIDENCE_DIR, "host-gui-evidence.md"),
    lines.join("\n"),
  );
  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    [
      ...evidence,
      ...results.map((row) => `item${row.item}=${row.status} ${row.notes}`),
      "",
    ].join("\n"),
  );

  const failed = results.filter((row) => row.status === "FAIL");
  expect(
    failed,
    failed.map((row) => `#${row.item} ${row.title}: ${row.notes}`).join("; "),
  ).toEqual([]);
});
