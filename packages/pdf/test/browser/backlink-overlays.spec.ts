import { expect, test, type Page } from "@playwright/test";
import { send } from "./view-controls-support";
import {
  lastSelection,
  messages,
  open,
  pagePoint,
  sendAction,
  TEXT_MIDLINE,
} from "./viewer-support";

/** Synthetic vault hit pointing at "Synthetic" on page 1 of the fixture PDF. */
const HIT = {
  noteUri: "file:///tmp/vault/notes/synthetic.md",
  notePath: "notes/synthetic.md",
  linkOffset: 12,
  pdfKey: "outline.pdf",
  page: 1,
  textFragment: { textStart: "Synthetic" },
};

async function highlightMarkCount(page: Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        '.page [style*="mix-blend-mode: multiply"], .page [style*="mix-blend-mode:multiply"]',
      ).length,
  );
}

async function injectBacklinks(page: Page) {
  await send(page, {
    type: "pdfBacklinks",
    load: 1,
    hits: [HIT],
  });
  await expect(page.locator(".pdf-backlink-overlay-line").first()).toBeVisible({
    timeout: 15_000,
  });
}

test("injected pdfBacklinks paints an overlay; click posts openBacklinkNote", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await injectBacklinks(page);
  const overlay = page.locator(".pdf-backlink-overlay").first();
  await expect(overlay).toHaveAttribute("title", HIT.notePath);
  await expect(overlay).toHaveAttribute("data-note-path", HIT.notePath);

  await overlay.locator(".pdf-backlink-overlay-line").first().click();
  await expect
    .poll(async () =>
      (await messages(page)).filter(
        (message) => message.type === "openBacklinkNote",
      ),
    )
    .toEqual([
      expect.objectContaining({
        type: "openBacklinkNote",
        noteUri: HIT.noteUri,
        linkOffset: HIT.linkOffset,
      }),
    ]);
});

test("a backlink overlay is never the menu's mark; a mark under it still is", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await injectBacklinks(page);
  const menuKeys = async () =>
    JSON.parse(
      (await page.evaluate(() =>
        document.body.getAttribute("data-vscode-context"),
      )) ?? "{}",
    ) as Record<string, boolean>;
  await page
    .locator(".pdf-backlink-overlay-line")
    .first()
    .click({ button: "right" });
  expect(await menuKeys()).toMatchObject({
    "lumiere.pdf.hasAnnotationSelection": false,
  });

  // Highlight "page 1" only, so overlay lines on "Synthetic" do not take the drag.
  const at = await pagePoint(page, 1);
  const baseline = await highlightMarkCount(page);
  await page.mouse.move(...at(150, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await lastSelection(page)) as { kind?: string } | null)
    .toMatchObject({ kind: "text" });
  await sendAction(page, { action: "markSelection", tool: "highlight" });
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  await page.mouse.click(...at(180, TEXT_MIDLINE), { button: "right" });
  expect(await menuKeys()).toMatchObject({
    "lumiere.pdf.hasAnnotationSelection": true,
  });
  await sendAction(page, { action: "deleteSelectedAnnotations" });
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
  await expect(page.locator(".pdf-backlink-overlay-line")).toHaveCount(1);
});
