import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
 * Host GUI: Annotate Highlight burns into the PDF (no sidecar); Delete removes
 * the embedded mark. Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";
const SIDECAR = `${PDF}.lumiere.md`;
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(paths.repository, "test-results", "host-gui-pr482");

test.setTimeout(180_000);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

async function highlightAcross(
  page: Page,
  viewer: Frame,
  x0: number,
  x1: number,
): Promise<void> {
  const at = await pagePoint(viewer, 1);
  await drag(page, at(x0, TEXT_MIDLINE), at(x1, TEXT_MIDLINE));
}

test("Annotate highlight burns in, creates no sidecar, Delete mutates PDF", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const sidecarPath = path.join(paths.workspace, SIDECAR);
  const evidence: string[] = [`pdf=${PDF}`, `host=cursor`];

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  await page.screenshot({
    path: path.join(SHOT_DIR, "01-pdf-open.png"),
    fullPage: true,
  });

  const beforeHash = sha256(pdfPath);
  evidence.push(`sha256_before_create=${beforeHash}`);

  await statusBarButton(page, "annotate").click();
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  await expect(statusBarButton(page, "annotationTool")).toBeVisible();

  await highlightAcross(page, viewer, 74, 205);
  await expect(viewer.locator(".sidecar-highlight")).toHaveCount(0);
  await expect
    .poll(() => sha256(pdfPath), { timeout: 20_000 })
    .not.toBe(beforeHash);
  expect(existsSync(sidecarPath)).toBe(false);
  const afterCreateHash = sha256(pdfPath);
  evidence.push(
    `sha256_after_create=${afterCreateHash}`,
    `sidecar_created=false`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "02-highlight-burn-in.png"),
    fullPage: true,
  });

  // New marks auto-select; Delete removes the embedded annot (PDF bytes change).
  const at = await pagePoint(viewer, 1);
  await page.mouse.click(...at(100, TEXT_MIDLINE).screen);
  await page.waitForTimeout(300);
  await page.keyboard.press("Delete");
  await expect
    .poll(() => sha256(pdfPath), { timeout: 20_000 })
    .not.toBe(afterCreateHash);
  evidence.push(
    `sha256_after_delete=${sha256(pdfPath)}`,
    `sidecar_after=${existsSync(sidecarPath)}`,
    `result=PASS`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "03-after-delete.png"),
    fullPage: true,
  });
  writeFileSync(path.join(SHOT_DIR, "evidence.txt"), evidence.join("\n") + "\n");
});
