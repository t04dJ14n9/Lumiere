import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { paths } from "./state";
import {
  closeAllEditors,
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
 * Host GUI: an Annotate highlight is kept in the workspace's annotation file
 * for the PDF's hash, never in the PDF (a vault records that hash); it comes
 * back when the PDF is opened again, and Delete removes it from that file.
 * Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(paths.repository, "test-results", "host-gui-pr482");
const STORE = path.join(paths.workspace, ".lumiere");

test.setTimeout(180_000);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function statusBarButton(page: Page, id: string) {
  return page.locator(`.part.statusbar [id$="lumiere.pdf.${id}"]`);
}

/**
 * An EmbedPDF highlight is a polygon inside the page. On white paper it is
 * multiplied into the page; on dark paper (this window's dark theme follows
 * to it) it has no blend mode, so the blend cannot be what finds it.
 */
function highlightMarks(viewer: Frame): Promise<number> {
  return viewer.evaluate(
    () => document.querySelectorAll(".page polygon").length,
  );
}

async function openAnnotating(page: Page): Promise<Frame> {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  return viewer;
}

test("an Annotate highlight is kept beside the PDF, comes back on reopen, and Delete removes it", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  rmSync(STORE, { recursive: true, force: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const pdfHash = sha256(pdfPath);
  const kept = path.join(STORE, "pdf-annotations", `${pdfHash}.json`);
  const evidence: string[] = [`pdf=${PDF}`, `sha256=${pdfHash}`];
  try {
    let viewer = await openAnnotating(page);
    const baseline = await highlightMarks(viewer);
    await statusBarButton(page, "annotate").click();
    await expect(statusBarButton(page, "annotate")).toContainText(
      /Annotating/u,
    );
    const at = await pagePoint(viewer, 1);
    await drag(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
    await expect.poll(() => existsSync(kept), { timeout: 20_000 }).toBe(true);
    const file = JSON.parse(readFileSync(kept, "utf8")) as {
      bundle: { items: { data: { subtype: string } }[] };
    };
    expect(file.bundle.items.map((item) => item.data.subtype)).toEqual([
      "highlight",
    ]);
    expect(sha256(pdfPath)).toBe(pdfHash);
    evidence.push(`kept=${path.relative(paths.workspace, kept)}`);
    await page.screenshot({
      path: path.join(SHOT_DIR, "02-highlight-kept.png"),
      fullPage: true,
    });

    // Opened again, the PDF shows the highlight from the annotation file.
    await closeAllEditors(page);
    viewer = await openAnnotating(page);
    await expect.poll(() => highlightMarks(viewer)).toBeGreaterThan(baseline);

    // Delete takes it out of the file; the PDF is still as it was.
    await statusBarButton(page, "annotate").click();
    await expect(statusBarButton(page, "annotate")).toContainText(
      /Annotating/u,
    );
    const again = await pagePoint(viewer, 1);
    await page.mouse.click(...again(100, TEXT_MIDLINE).screen);
    await page.waitForTimeout(300);
    await page.keyboard.press("Delete");
    await expect.poll(() => existsSync(kept), { timeout: 20_000 }).toBe(false);
    expect(sha256(pdfPath)).toBe(pdfHash);
    evidence.push("result=PASS");
    await page.screenshot({
      path: path.join(SHOT_DIR, "03-after-delete.png"),
      fullPage: true,
    });
  } finally {
    writeFileSync(
      path.join(SHOT_DIR, "evidence.txt"),
      evidence.join("\n") + "\n",
    );
    await closeAllEditors(page);
    rmSync(STORE, { recursive: true, force: true });
  }
});
