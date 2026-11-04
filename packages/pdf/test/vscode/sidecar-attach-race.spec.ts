import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
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
 * Host GUI: Annotate → Highlight burns into the PDF and must not create a
 * sidecar (create-path teardown). Synthetic outline.pdf only.
 */
const PDF = "docs/outline.pdf";
const SIDECAR = `${PDF}.lumiere.md`;
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(paths.repository, "test-results", "host-gui-pr479");

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

test("Annotate Highlight burns into the PDF and does not create a sidecar", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const sidecarPath = path.join(paths.workspace, SIDECAR);
  const beforeHash = sha256(pdfPath);

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  await page.screenshot({
    path: path.join(SHOT_DIR, "01-pdf-open.png"),
    fullPage: true,
  });

  await statusBarButton(page, "annotate").click();
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  await expect(statusBarButton(page, "annotationTool")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "02-annotate-on.png"),
    fullPage: true,
  });

  const at = await pagePoint(viewer, 1);
  await drag(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect(viewer.locator(".sidecar-highlight")).toHaveCount(0);
  await expect
    .poll(() => sha256(pdfPath), { timeout: 20_000 })
    .not.toBe(beforeHash);

  expect(existsSync(sidecarPath), "must not create sidecar").toBe(false);

  await page.screenshot({
    path: path.join(SHOT_DIR, "03-after-highlight-burn-in.png"),
    fullPage: true,
  });

  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    [
      `pdf=${PDF}`,
      `sha256_before=${beforeHash}`,
      `sha256_after=${sha256(pdfPath)}`,
      `sidecar_created=${existsSync(sidecarPath)}`,
      `sidecar_paint_count=0`,
      `result=PASS`,
      "",
    ].join("\n"),
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "04-done.png"),
    fullPage: true,
  });
});
