import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { paths } from "./state";
import {
  command,
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
 * Host GUI (#482): Annotate → sidecar Highlight → click-select → Delete removes
 * overlay + sidecar block with PDF bytes unchanged; paper-aware highlight
 * defaults (normal #FFE566@0.3 / dark #FFF59D@0.4). Synthetic fixtures only.
 *
 * When pdfSidecar owns the panel, Annotate's Highlight tool writes the sidecar
 * (not the PDF). Direct-to-PDF delete is covered for Underline in the same run.
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

async function lineStyle(viewer: Frame): Promise<{
  color: string;
  opacity: string;
  cssColor: string;
  cssOpacity: string;
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
      };
    });
}

/** Cycle Page Colors until the status-bar label matches `want` (Normal|Dark|Follow). */
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

async function highlightAcross(
  page: Page,
  viewer: Frame,
  x0: number,
  x1: number,
): Promise<void> {
  const at = await pagePoint(viewer, 1);
  await drag(page, at(x0, TEXT_MIDLINE), at(x1, TEXT_MIDLINE));
}

test("Annotate highlight delete + paper-aware colors on Cursor (sidecar + underline)", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const sidecarPath = path.join(paths.workspace, SIDECAR);
  const evidence: string[] = [
    `pdf=${PDF}`,
    `host=cursor`,
    `branch=fix/pdf-annotate-delete-color`,
  ];

  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  await page.screenshot({
    path: path.join(SHOT_DIR, "01-pdf-open.png"),
    fullPage: true,
  });

  // Force light paper so the first highlight uses #FFE566@0.3 (Follow+dark
  // theme would otherwise pick the dark defaults).
  await cycleUntilPageColors(page, /\bNormal\b/u);
  evidence.push(`page_colors_light=Normal`);

  const beforeHash = sha256(pdfPath);
  const beforeMtimeMs = statSync(pdfPath).mtimeMs;
  evidence.push(`sha256_before_create=${beforeHash}`);

  await statusBarButton(page, "annotate").click();
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  await expect(statusBarButton(page, "annotationTool")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "02-annotate-on-normal-paper.png"),
    fullPage: true,
  });

  await highlightAcross(page, viewer, 74, 205);
  await expect(viewer.locator(".sidecar-highlight-line").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => existsSync(sidecarPath), { timeout: 15_000 })
    .toBe(true);

  const sidecar = readFileSync(sidecarPath, "utf8");
  expect(sidecar).toMatch(/lumiere-pdf-sidecar:\s*1/);
  expect(sidecar).toMatch(/<!--[ \t]*lumiere-highlight\b/);
  expect(sidecar).toMatch(/id:\s*hl-[0-9a-f]{8}/);
  expect(sidecar).toMatch(/subtype:\s*highlight/);
  expect(sidecar).toMatch(/quote:\s*"Synthetic page 1"/);
  expect(sidecar).toMatch(/color:\s*"#FFE566"/);
  expect(sidecar).toMatch(/opacity:\s*0\.3\b/);
  expect(sidecar).not.toMatch(/WorkVault|金扬/);

  const lightStyle = await lineStyle(viewer);
  expect(lightStyle.color.toUpperCase()).toBe("#FFE566");
  expect(Number(lightStyle.opacity)).toBeCloseTo(0.3, 5);
  evidence.push(
    `light_sidecar_color=${lightStyle.color}`,
    `light_sidecar_opacity=${lightStyle.opacity}`,
    `light_css_background=${lightStyle.cssColor}`,
    `light_css_opacity=${lightStyle.cssOpacity}`,
  );

  const afterCreateHash = sha256(pdfPath);
  expect(afterCreateHash, "PDF bytes unchanged after sidecar highlight").toBe(
    beforeHash,
  );
  expect(statSync(pdfPath).mtimeMs).toBe(beforeMtimeMs);

  await page.screenshot({
    path: path.join(SHOT_DIR, "03-light-highlight-created.png"),
    fullPage: true,
  });

  // Deselect, then click-select the mark (proves hit-test routing for Delete).
  const at = await pagePoint(viewer, 1);
  await page.mouse.click(...at(150, 200).screen);
  await expect(viewer.locator(".sidecar-highlight.is-selected")).toHaveCount(
    0,
    {
      timeout: 10_000,
    },
  );
  await page.mouse.click(...at(100, TEXT_MIDLINE).screen);
  await expect(viewer.locator(".sidecar-highlight.is-selected")).toHaveCount(
    1,
    {
      timeout: 10_000,
    },
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "04-highlight-selected.png"),
    fullPage: true,
  });

  await page.keyboard.press("Delete");
  await expect(viewer.locator(".sidecar-highlight")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect
    .poll(() => {
      if (!existsSync(sidecarPath)) {
        return "gone";
      }
      const body = readFileSync(sidecarPath, "utf8");
      return /<!--[ \t]*lumiere-highlight\b/.test(body) ? "has" : "empty";
    })
    .not.toBe("has");

  const afterDeleteHash = sha256(pdfPath);
  expect(afterDeleteHash, "PDF bytes unchanged after sidecar Delete").toBe(
    beforeHash,
  );
  expect(statSync(pdfPath).mtimeMs).toBe(beforeMtimeMs);
  evidence.push(
    `sha256_after_sidecar_delete=${afterDeleteHash}`,
    `sha256_match_sidecar_delete=${afterDeleteHash === beforeHash}`,
    `sidecar_highlight_block_after_delete=${existsSync(sidecarPath) ? (/<!--[ \t]*lumiere-highlight\b/.test(readFileSync(sidecarPath, "utf8")) ? "present" : "absent") : "file_gone"}`,
  );

  await page.screenshot({
    path: path.join(SHOT_DIR, "05-after-sidecar-delete.png"),
    fullPage: true,
  });

  // Dark paper: new highlight defaults to #FFF59D @ 0.4.
  await cycleUntilPageColors(page, /\bDark\b/u);
  evidence.push(`page_colors_dark=Dark`);
  await expect(statusBarButton(page, "annotate")).toContainText(/Annotating/u);
  await highlightAcross(page, viewer, 74, 180);
  await expect(viewer.locator(".sidecar-highlight-line").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => {
      if (!existsSync(sidecarPath)) {
        return false;
      }
      const body = readFileSync(sidecarPath, "utf8");
      return /color:\s*"#FFF59D"/.test(body) && /opacity:\s*0\.4\b/.test(body);
    })
    .toBe(true);

  const darkStyle = await lineStyle(viewer);
  expect(darkStyle.color.toUpperCase()).toBe("#FFF59D");
  expect(Number(darkStyle.opacity)).toBeCloseTo(0.4, 5);
  evidence.push(
    `dark_sidecar_color=${darkStyle.color}`,
    `dark_sidecar_opacity=${darkStyle.opacity}`,
    `dark_css_background=${darkStyle.cssColor}`,
    `dark_css_opacity=${darkStyle.cssOpacity}`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "06-dark-highlight-created.png"),
    fullPage: true,
  });

  // Clean up dark highlight so Underline path starts from a clear sidecar.
  await page.mouse.click(...at(100, TEXT_MIDLINE).screen);
  await expect(viewer.locator(".sidecar-highlight.is-selected")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(viewer.locator(".sidecar-highlight")).toHaveCount(0, {
    timeout: 15_000,
  });

  // Built-in / direct-to-PDF: Highlight is sidecar-owned; Underline still
  // writes into the PDF. Verify create + Delete for that mark type.
  evidence.push(
    `builtin_highlight_via_pdf=unavailable_when_sidecar_owns_panel`,
    `builtin_mark_type_tested=underline`,
  );
  await command(page, "PDF: Annotation Tool…");
  await expect(
    page.locator(".quick-input-widget").filter({ hasText: /Annotation Tool/u }),
  ).toBeVisible({ timeout: 10_000 });
  await page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: /Underline/u })
    .first()
    .click();
  await expect(statusBarButton(page, "annotationTool")).toContainText(
    /Underline/u,
  );

  const beforeUnderlineHash = sha256(pdfPath);
  await highlightAcross(page, viewer, 74, 205);
  // EmbedPDF underline should mutate PDF bytes (direct-to-PDF).
  await expect
    .poll(() => sha256(pdfPath), { timeout: 20_000 })
    .not.toBe(beforeUnderlineHash);
  const afterUnderlineHash = sha256(pdfPath);
  evidence.push(
    `sha256_before_underline=${beforeUnderlineHash}`,
    `sha256_after_underline_create=${afterUnderlineHash}`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "07-underline-created.png"),
    fullPage: true,
  });

  // New marks auto-select; Delete key removes EmbedPDF underline (direct-to-PDF).
  // Palette "PDF: Delete Annotation" is when-clause gated and flaky to discover
  // on Cursor when focus is in the webview — keyboard matches product UX.
  await page.mouse.click(...at(120, TEXT_MIDLINE).screen);
  await page.waitForTimeout(300);
  await page.keyboard.press("Delete");
  await expect
    .poll(() => sha256(pdfPath), { timeout: 20_000 })
    .not.toBe(afterUnderlineHash);
  const afterUnderlineDeleteHash = sha256(pdfPath);
  evidence.push(
    `sha256_after_underline_delete=${afterUnderlineDeleteHash}`,
    `underline_delete_changed_pdf=${afterUnderlineDeleteHash !== afterUnderlineHash}`,
    `underline_delete_via=keyboard`,
    `result=PASS`,
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "08-after-underline-delete.png"),
    fullPage: true,
  });

  writeFileSync(
    path.join(SHOT_DIR, "evidence.txt"),
    evidence.join("\n") + "\n",
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, "09-done.png"),
    fullPage: true,
  });
});
