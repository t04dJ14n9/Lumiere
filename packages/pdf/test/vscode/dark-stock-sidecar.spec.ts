import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { paths } from "./state";
import {
  expect,
  fitPage,
  openFile,
  pdfViewer,
  showPage,
  test,
} from "./workbench";

/**
 * Host GUI: a preloaded legacy sidecar must not paint `.sidecar-highlight`
 * overlays after create-path teardown. Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";
const SIDECAR = `${PDF}.lumiere.md`;
const SHOT_DIR = path.join(
  paths.repository,
  "test-results",
  "host-gui-dark-stock-sidecar",
);

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

function stockSidecarMarkdown(): string {
  return `---
lumiere-pdf-sidecar: 1
source: "outline.pdf"
---

<!-- lumiere-highlight
id: hl-0badf00d
page: 1
subtype: highlight
color: "#FFCD45"
opacity: 1
segmentRects:
  - { x: 72, y: 88, w: 120, h: 14 }
  - { x: 72, y: 104, w: 90, h: 14 }
quote: "Synthetic page 1"
contextBefore: ""
contextAfter: " Second line 1"
created: "2026-11-03T00:00:00.000Z"
modified: "2026-11-03T00:00:00.000Z"
-->
`;
}

test("preloaded sidecar is not painted; file is left on disk", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const sidecarPath = path.join(paths.workspace, SIDECAR);
  writeFileSync(sidecarPath, stockSidecarMarkdown());
  const evidence: string[] = [
    `pdf=${PDF}`,
    `preloaded_sidecar=true`,
    `expect_paint=false`,
  ];

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  await cycleUntilPageColors(page, /\bDark\b/u);

  await expect(viewer.locator(".sidecar-highlight")).toHaveCount(0);
  expect(existsSync(sidecarPath), "no auto-delete of sidecar").toBe(true);

  await page.screenshot({
    path: path.join(SHOT_DIR, "01-dark-no-sidecar-paint.png"),
    fullPage: true,
  });
  evidence.push(`sidecar_still_on_disk=true`, `result=PASS`);
  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    evidence.join("\n") + "\n",
  );
});
