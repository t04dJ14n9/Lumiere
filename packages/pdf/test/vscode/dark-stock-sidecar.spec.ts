import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { paths } from "./state";
import {
  drag,
  expect,
  fitPage,
  openFile,
  pagePoint,
  pdfViewer,
  showPage,
  test,
} from "./workbench";

/**
 * Host GUI residual after #482: EmbedPDF stock #FFCD45@1 sidecar marks on Dark
 * paper must paint as paper-aware #FFF59D@0.4 (CVM dazzle was solid yellow).
 * Synthetic outline.pdf + synthetic .lumiere.md only.
 */
const PDF = "docs/outline.pdf";
const SIDECAR = `${PDF}.lumiere.md`;
const SHOT_DIR = path.join(
  paths.repository,
  "test-results",
  "host-gui-dark-stock-sidecar",
);
const TEXT_LINE1 = 94;

test.setTimeout(180_000);

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

async function cycleUntilPageColors(
  page: Page,
  want: RegExp,
  maxClicks = 4,
): Promise<void> {
  const button = statusBarButton(page, "pageColors");
  await expect(button).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < maxClicks; i++) {
    const text = (await button.innerText()).replace(/\s+/gu, " ");
    if (want.test(text)) {
      return;
    }
    await button.click();
    await page.waitForTimeout(400);
  }
  await expect(button).toContainText(want);
}

async function lineStyle(viewer: Frame): Promise<{
  color: string;
  opacity: string;
  cssColor: string;
  cssOpacity: string;
  lineCount: number;
}> {
  return viewer
    .locator(".sidecar-highlight")
    .first()
    .evaluate((el) => {
      const line = el.querySelector(".sidecar-highlight-line") as HTMLElement;
      const style = getComputedStyle(line);
      return {
        color: (el as HTMLElement).style
          .getPropertyValue("--highlight-color")
          .trim(),
        opacity: (el as HTMLElement).style
          .getPropertyValue("--highlight-opacity")
          .trim(),
        cssColor: style.backgroundColor,
        cssOpacity: style.opacity,
        lineCount: el.querySelectorAll(".sidecar-highlight-line").length,
      };
    });
}

function stockSidecarMarkdown(): string {
  // Two dense lines covering Synthetic page 1 + Second line 1 (viewer coords
  // from top; fixtures put baselines at 100 and 130 pt).
  return `---
lumiere-pdf-sidecar: 1
source: "outline.pdf"
---

<!-- lumiere-highlight
id: hl-stock01
page: 1
subtype: highlight
color: "#FFCD45"
opacity: 1
segmentRects:
  - { x: 72, y: 82, w: 160, h: 22 }
  - { x: 72, y: 112, w: 140, h: 20 }
quote: "Synthetic page 1"
contextBefore: ""
contextAfter: " Second line 1"
created: "2026-11-03T00:00:00.000Z"
modified: "2026-11-03T00:00:00.000Z"
-->
`;
}

test("Dark paper remaps EmbedPDF stock #FFCD45@1 sidecar + new annotate", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const sidecarPath = path.join(paths.workspace, SIDECAR);
  writeFileSync(sidecarPath, stockSidecarMarkdown());
  const evidence: string[] = [
    `pdf=${PDF}`,
    `host=cursor`,
    `branch=fix/pdf-dark-sidecar-highlight-readability`,
    `preloaded_sidecar_color=#FFCD45`,
    `preloaded_sidecar_opacity=1`,
  ];

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);

  await cycleUntilPageColors(page, /\bDark\b/u);
  evidence.push(`page_colors=Dark`);

  await expect(viewer.locator(".sidecar-highlight-line").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => {
      const style = await lineStyle(viewer);
      return `${style.color.toUpperCase()}@${style.opacity}:${style.lineCount}`;
    })
    .toBe("#FFF59D@0.4:2");

  const stockPaint = await lineStyle(viewer);
  evidence.push(
    `stock_paint_color=${stockPaint.color}`,
    `stock_paint_opacity=${stockPaint.opacity}`,
    `stock_css_background=${stockPaint.cssColor}`,
    `stock_css_opacity=${stockPaint.cssOpacity}`,
    `stock_line_count=${stockPaint.lineCount}`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "01-dark-stock-sidecar-remapped.png"),
    fullPage: true,
  });

  // Keep file stock on disk — paint remaps without rewriting the sidecar.
  const onDisk = readFileSync(sidecarPath, "utf8");
  expect(onDisk).toMatch(/color:\s*"#FFCD45"/);
  expect(onDisk).toMatch(/opacity:\s*1\b/);
  evidence.push(`sidecar_file_still_stock=true`);

  // Selection-box "left hang" on the user Normal-paper crop was measured as
  // L_yellow == L_blue (no transform divergence vs sidecar segmentRects×scale).
  // Tracked separately; this Host GUI proves the stock-color residual only.

  // New Annotate write on Dark must store paper-aware pair (not stock).
  const at = await pagePoint(viewer, 1);
  await statusBarButton(page, "annotate").click();
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  // Drag a third band lower on the page for a denser multi-line look.
  await drag(page, at(72, TEXT_LINE1 + 50), at(200, TEXT_LINE1 + 50));
  await expect
    .poll(() => {
      if (!existsSync(sidecarPath)) {
        return false;
      }
      const body = readFileSync(sidecarPath, "utf8");
      return /color:\s*"#FFF59D"/.test(body) && /opacity:\s*0\.4\b/.test(body);
    })
    .toBe(true);

  evidence.push(`new_dark_write_color=#FFF59D`, `new_dark_write_opacity=0.4`);
  await page.screenshot({
    path: path.join(SHOT_DIR, "02-dark-new-annotate-plus-stock.png"),
    fullPage: true,
  });

  // Dense multi-line: force another drag on second line area after deleting
  // is unnecessary — screenshot the stock two-line remapped bands closely.
  await page.mouse.click(...at(10, 10).screen);
  await page.screenshot({
    path: path.join(SHOT_DIR, "03-dark-dense-multiline-bands.png"),
    fullPage: true,
  });

  evidence.push(`result=PASS`);
  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    evidence.join("\n") + "\n",
  );
});
