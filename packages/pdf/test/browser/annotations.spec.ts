import { expect, test, type Page } from "@playwright/test";
import {
  open,
  sendAction,
  pagePoint,
  lastView,
  lastSelection,
  selectText,
  TEXT_MIDLINE,
} from "./viewer-support";

/** EmbedPDF highlight marks use multiply blend rectangles inside the page. */
async function highlightMarkCount(page: Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        '.page [style*="mix-blend-mode: multiply"], .page [style*="mix-blend-mode:multiply"]',
      ).length,
  );
}

/** The messages the viewer sent of one type. */
const sent = (page: Page, type: string) =>
  page.evaluate(
    (type) =>
      (
        window as unknown as {
          __messages: { type: string; text?: string | null }[];
        }
      ).__messages.filter((message) => message.type === type),
    type,
  );

test("Annotate mode has no viewer bar and Escape returns to text", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "annotate" });
  await expect(
    page.getByRole("group", { name: "PDF annotation tools" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("toolbar", { name: "PDF annotation bar" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Annotate", exact: true }),
  ).toHaveCount(0);
  const viewport = (await page.locator(".viewport").boundingBox())!;
  expect(viewport.y).toBe(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "text" });
});

test("the slim bar does not gain an Annotate control", async ({ page }) => {
  await open(page, "?toolbar=slim");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "annotate" });
  await expect(
    page.getByRole("toolbar", { name: "PDF toolbar" }).getByRole("button", {
      name: "Annotate",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "PDF annotation tools" }),
  ).toHaveCount(0);
});

test("highlight tool can mark text", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  const at = await pagePoint(page, 1);
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  // The mark is kept in Lumiere's annotation file, not written into the PDF:
  // its bytes (and their hash, which a vault records) stay as they were.
  await expect
    .poll(async () => (await sent(page, "annotationStoreSave")).length)
    .toBeGreaterThan(0);
  const kept = JSON.parse(
    (await sent(page, "annotationStoreSave")).at(-1)!.text!,
  ) as { version: number; bundle: { items: { data: { subtype: string } }[] } };
  expect(kept.version).toBe(2);
  expect(kept.bundle.items.map((item) => item.data.subtype)).toContain(
    "highlight",
  );
  expect(await sent(page, "annotationSave")).toHaveLength(0);
});

test("annotation undo clears an in-session highlight", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  const at = await pagePoint(page, 1);
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  await sendAction(page, { action: "annotationUndo" });
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
});

test("created annotation auto-selects as region and deletes with Delete", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  const at = await pagePoint(page, 1);
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  // selectAfterCreate: selection should be reported as a region for handoff.
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string; page?: number }).kind
        : undefined;
    })
    .toBe("region");
  await page.keyboard.press("Delete");
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
});

test("click-to-select mark reports region and survives reportSelection", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  const at = await pagePoint(page, 1);
  const mid = at(140, TEXT_MIDLINE);
  await page.mouse.move(...at(74, TEXT_MIDLINE));
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

  // Escape exits Annotate and clears EmbedPDF selection; re-enter and click the mark.
  await page.keyboard.press("Escape");
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "text" });
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection;
    })
    .toBeNull();
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await page.mouse.click(...mid);
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string }).kind
        : undefined;
    })
    .toBe("region");
  // Capture-phase embedded select → Delete (Nit from #482 review).
  await page.keyboard.press("Delete");
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
  // Recreate for the reportSelection path below.
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  await page.mouse.click(...mid);
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string }).kind
        : undefined;
    })
    .toBe("region");

  // Host Copy Link / ensureSelection path: reportSelection keeps the region.
  const before = await lastSelection(page);
  await page.evaluate(() =>
    (window as unknown as { hostSend: (message: unknown) => void }).hostSend({
      type: "reportSelection",
    }),
  );
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string }).kind
        : undefined;
    })
    .toBe("region");
  const after = await lastSelection(page);
  expect(after).toMatchObject({
    kind: "region",
    page: (before as { page?: number }).page,
  });
});

// EmbedPDF 3 decides this by the active tool, not by a pointer-events style on
// the layer: the reading tool lacks the annotation-edit ability, so a mark
// under the pointer is not there to select, move or delete in View mode.
test("a mark can be selected and deleted only in Annotate mode", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  const at = await pagePoint(page, 1);
  const mid = at(140, TEXT_MIDLINE);
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);

  await page.keyboard.press("Escape");
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "text" });
  await expect.poll(() => lastSelection(page)).toBeNull();
  const marked = await highlightMarkCount(page);
  await page.mouse.click(...mid);
  await page.keyboard.press("Delete");
  // Nothing reacts to a click: wait a few frames before saying so.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await lastSelection(page)).toBeNull();
  expect(await highlightMarkCount(page)).toBe(marked);

  await sendAction(page, { action: "setTool", tool: "annotate" });
  await page.mouse.click(...mid);
  await expect
    .poll(async () => (await lastSelection(page)) as { kind?: string } | null)
    .toMatchObject({ kind: "region" });
  await page.keyboard.press("Delete");
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
});

test("text tool still selects text with marks on the page", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "text" });
  const at = await pagePoint(page, 1);
  await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect
    .poll(async () => {
      const selection = await lastSelection(page);
      return selection && typeof selection === "object"
        ? (selection as { kind?: string }).kind
        : undefined;
    })
    .toBe("text");
});
