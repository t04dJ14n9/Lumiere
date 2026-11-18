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
  contextMenu,
  contextMenuLabels,
  expect,
  fitPage,
  openFile,
  pagePoint,
  pdfViewer,
  selectText,
  showPage,
  test,
} from "./workbench";

/**
 * Host GUI: select text, right-click, Highlight. The highlight is kept in
 * the workspace's annotation file for the PDF's hash, never in the PDF (a
 * vault records that hash); it comes back
 * when the PDF is opened again, and the mark's own context menu deletes it
 * from that file. There is no Annotate button. Synthetic fixtures only.
 */
const PDF = "docs/outline.pdf";
const TEXT_MIDLINE = 94;
const SHOT_DIR = path.join(
  paths.repository,
  "test-results",
  "host-gui-annotate-context-menu",
);
const STORE = path.join(paths.workspace, ".lumiere");

test.setTimeout(180_000);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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

async function openFirstPage(page: Page): Promise<Frame> {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await fitPage(page, viewer);
  await showPage(page, viewer, 1);
  return viewer;
}

type Kept = {
  bundle: { items: { data: { subtype: string; contents?: string } }[] };
};

test("Highlight from the context menu keeps a highlight beside the PDF, and the mark's menu deletes it", async ({
  workbench: page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  rmSync(STORE, { recursive: true, force: true });
  const pdfPath = path.join(paths.workspace, PDF);
  const pdfHash = sha256(pdfPath);
  const kept = path.join(STORE, "pdf-annotations", `${pdfHash}.json`);
  const evidence: string[] = [`pdf=${PDF}`, `sha256=${pdfHash}`];
  try {
    let viewer = await openFirstPage(page);
    await expect(
      page.locator('.part.statusbar [id$="lumiere.pdf.annotate"]'),
    ).toHaveCount(0);
    const baseline = await highlightMarks(viewer);
    const at = await pagePoint(viewer, 1);
    await selectText(page, viewer, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
    const offered = await contextMenuLabels(page, at(140, TEXT_MIDLINE));
    // The four text marks side by side, beside Copy link to this; no Add
    // Annotation and no Mark Text submenu.
    expect(offered).toEqual(
      expect.arrayContaining([
        "Copy link to this",
        "Highlight",
        "Underline",
        "Strikeout",
        "Squiggly",
      ]),
    );
    for (const gone of ["Add Annotation…", "Mark Text", "Delete Annotation"]) {
      expect(offered).not.toContain(gone);
    }

    await contextMenu(page, at(140, TEXT_MIDLINE), "Highlight");
    await expect.poll(() => existsSync(kept), { timeout: 20_000 }).toBe(true);
    await expect
      .poll(
        () =>
          (JSON.parse(readFileSync(kept, "utf8")) as Kept).bundle.items.map(
            (item) => item.data.subtype,
          ),
        { timeout: 20_000 },
      )
      .toEqual(["highlight"]);
    expect(sha256(pdfPath)).toBe(pdfHash);
    evidence.push(`kept=${path.relative(paths.workspace, kept)}`);
    await page.screenshot({
      path: path.join(SHOT_DIR, "01-annotation-kept.png"),
      fullPage: true,
    });

    // Opened again, the PDF shows the highlight from the annotation file.
    await closeAllEditors(page);
    viewer = await openFirstPage(page);
    await expect.poll(() => highlightMarks(viewer)).toBeGreaterThan(baseline);

    // The mark's own menu: its note, colour and Delete, not the text actions.
    const again = await pagePoint(viewer, 1);
    const onMark = await contextMenuLabels(page, again(140, TEXT_MIDLINE));
    expect(onMark).toEqual(
      expect.arrayContaining([
        "Edit Note…",
        "Change Color",
        "Delete Annotation",
      ]),
    );
    expect(onMark).not.toContain("Highlight");
    await contextMenu(page, again(140, TEXT_MIDLINE), "Delete Annotation");
    await expect.poll(() => existsSync(kept), { timeout: 20_000 }).toBe(false);
    expect(sha256(pdfPath)).toBe(pdfHash);
    evidence.push("result=PASS");
    await page.screenshot({
      path: path.join(SHOT_DIR, "02-after-delete.png"),
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
