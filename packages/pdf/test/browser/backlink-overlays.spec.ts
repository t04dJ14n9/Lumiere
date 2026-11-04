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

test("Delete ignores backlink overlays; Delete still removes an embedded annot", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await injectBacklinks(page);
  await page.locator(".pdf-backlink-overlay-line").first().click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".pdf-backlink-overlay-line")).toHaveCount(1);

  // Same Del path as freeText/Note (hasAnnotationSelection → deleteSelected).
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const at = await pagePoint(page, 1);
  const baseline = await highlightMarkCount(page);
  // Drag over "page 1" only so overlay lines on "Synthetic" do not steal the gesture.
  await page.mouse.move(...at(150, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string }).kind
        : undefined;
    })
    .toBe("region");
  await page.keyboard.press("Delete");
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
  await expect(page.locator(".pdf-backlink-overlay-line")).toHaveCount(1);
});
