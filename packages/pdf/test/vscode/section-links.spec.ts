import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { docScreenshot, reopenWith } from "../../../../test/vscode/workbench";
import { paths } from "./state";
import { closeAllEditors, expect, openFile, test } from "./workbench";

const NOTE = "section-links.md";

/** The frame of Lumiere's Markdown editor, once it has opened. */
async function lumiaEditor(page: Page): Promise<Frame> {
  let editor: Frame | undefined;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (
          await frame.getByRole("textbox", { name: "Markdown content" }).count()
        ) {
          editor = frame;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return editor!;
}

test("typing [[docs/outline.pdf#Sec lists the PDF's bookmarks, and Enter links the bookmark's page", async ({
  workbench: page,
}) => {
  const note = path.join(paths.workspace, NOTE);
  writeFileSync(note, "");
  try {
    await openFile(page, NOTE);
    await reopenWith(page, "Lumiere");
    const frame = await lumiaEditor(page);
    await frame.getByRole("textbox", { name: "Markdown content" }).click();
    await page.keyboard.type("[[docs/outline.pdf#Sec");

    // outline.pdf: Part One, Section 1.1 (page 2), Section 1.2 (page 3),
    // Part Two, Section 2.1 (page 9). The first request starts PDFium.
    const options = frame.locator(".cm-tooltip-autocomplete li[role=option]");
    await expect(options.first()).toContainText("Section 1.1");
    await expect(options).toHaveText([
      /Section 1\.1/u,
      /Section 1\.2/u,
      /Section 2\.1/u,
    ]);
    await expect(options.first()).toContainText("p.2 · docs/outline.pdf");
    await page.screenshot({ path: docScreenshot("pdf-section-links.png") });

    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFileSync(note, "utf8"))
      .toBe("[[docs/outline.pdf#page=2|Section 1.1]]");
  } finally {
    await closeAllEditors(page);
    rmSync(note, { force: true });
  }
});
