import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
 * Host GUI: while pdfSidecar owns the panel, Annotate → Highlight must not
 * mutate the PDF (attach-race Important from #475 review). Unit tests cover
 * the null→[] claim; this proves the product path on a real Cursor/VS Code.
 */
const PDF = "docs/outline.pdf";
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(paths.repository, "test-results", "host-gui-pr479");

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

test("Annotate Highlight after open leaves the PDF bytes alone and writes the sidecar", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const sidecarPath = `${pdfPath}.lumiere.md`;
  const beforeHash = sha256(pdfPath);
  const beforeMtimeMs = statSync(pdfPath).mtimeMs;

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  await page.screenshot({
    path: path.join(SHOT_DIR, "01-pdf-open.png"),
    fullPage: true,
  });

  // Enter Annotate as soon as the viewer is up (default tool is Highlight).
  await statusBarButton(page, "annotate").click();
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  await expect(statusBarButton(page, "annotationTool")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "02-annotate-on.png"),
    fullPage: true,
  });

  const at = await pagePoint(viewer, 1);
  await drag(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect(viewer.locator(".sidecar-highlight-line").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: path.join(SHOT_DIR, "03-after-highlight.png"),
    fullPage: true,
  });

  await expect
    .poll(() => existsSync(sidecarPath), { timeout: 15_000 })
    .toBe(true);
  const sidecar = readFileSync(sidecarPath, "utf8");
  expect(sidecar).toMatch(/lumiere-pdf-sidecar:\s*1/);
  expect(sidecar).toMatch(/<!--[ \t]*lumiere-highlight\b/);
  expect(sidecar).toMatch(/id:\s*hl-[0-9a-f]{8}/);
  expect(sidecar).toMatch(/subtype:\s*highlight/);

  const afterHash = sha256(pdfPath);
  const afterMtimeMs = statSync(pdfPath).mtimeMs;
  expect(afterHash, "PDF bytes must be unchanged").toBe(beforeHash);
  expect(afterMtimeMs, "PDF mtime must be unchanged").toBe(beforeMtimeMs);

  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    [
      `pdf=${PDF}`,
      `sha256_before=${beforeHash}`,
      `sha256_after=${afterHash}`,
      `mtime_before_ms=${beforeMtimeMs}`,
      `mtime_after_ms=${afterMtimeMs}`,
      `sidecar=${path.basename(sidecarPath)}`,
      `sidecar_bytes=${Buffer.byteLength(sidecar)}`,
      `sidecar_has_highlight=${/id:\s*hl-[0-9a-f]{8}/.test(sidecar)}`,
      "",
    ].join("\n"),
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "04-done.png"),
    fullPage: true,
  });
});
