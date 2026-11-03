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

/** A sidecar highlight over "Synthetic" on page 1 (its glyphs end before x 148). */
const SYNTHETIC = {
  id: "hl-0badf00d",
  page: 1,
  subtype: "highlight" as const,
  color: "#FFE566",
  opacity: 0.45,
  segmentRects: [{ x: 72, y: 88, w: 76, h: 14 }],
  quote: "Synthetic",
  contextBefore: "",
  contextAfter: " page 1",
  created: "2026-11-01T18:00:00.000Z",
  modified: "2026-11-01T18:00:00.000Z",
};

const writes = async (page: Page) =>
  (await messages(page)).filter((message) => message.type === "sidecarWrite");

/** What the viewer asked the host to write into the PDF file, decoded. */
const pdfSaves = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __messages: { type: string; data?: ArrayBuffer }[];
      }
    ).__messages
      .filter((message) => message.type === "annotationSave")
      .map((message) =>
        new TextDecoder("latin1").decode(new Uint8Array(message.data!)),
      ),
  );

const selectedKind = async (page: Page) =>
  ((await lastSelection(page)) as { kind?: string; highlightId?: string })
    ?.highlightId;

async function highlightAcross(page: Page, from: number, to: number) {
  const at = await pagePoint(page, 1);
  await page.mouse.move(...at(from, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(to, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
}

test("with a sidecar, the highlight tool writes the sidecar and never the PDF", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, { type: "sidecar", highlights: [] });
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  await highlightAcross(page, 74, 205);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const [write] = (await writes(page)) as unknown as {
    op: string;
    highlight: Record<string, unknown> & { segmentRects: unknown[] };
  }[];
  expect(write!.op).toBe("upsert");
  expect(write!.highlight).toMatchObject({
    id: expect.stringMatching(/^hl-[0-9a-f]{8}$/),
    page: 1,
    subtype: "highlight",
    quote: expect.stringContaining("Synthetic page"),
    // Light-paper default (harness has normal paper).
    color: "#FFE566",
    opacity: 0.3,
  });
  expect(write!.highlight.segmentRects.length).toBeGreaterThan(0);
  await expect(page.locator(".sidecar-highlight-line")).not.toHaveCount(0);
  // It is selected, as a new mark is, and links by its id.
  await expect
    .poll(() => selectedKind(page))
    .toBe(write!.highlight.id as string);
  // The PDF is not written: no save, and no EmbedPDF mark in the page.
  await page.waitForTimeout(800);
  expect(await pdfSaves(page)).toEqual([]);
  // A highlight just made is in place: re-attaching leaves it alone.
  expect(await writes(page)).toHaveLength(1);
  expect(
    await page.locator('.page [style*="mix-blend-mode: multiply"]').count(),
  ).toBe(0);
});

test("a sidecar highlight is shown, selected by a click in Annotate mode, and deleted", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, { type: "sidecar", highlights: [SYNTHETIC] });
  const line = page.locator(
    '.sidecar-highlight[data-highlight-id="hl-0badf00d"] .sidecar-highlight-line',
  );
  await expect(line).toHaveCount(1);
  const at = await pagePoint(page, 1);
  const box = (await line.boundingBox())!;
  const [x, y] = at(72, 88);
  expect(Math.abs(box.x - x)).toBeLessThan(1);
  expect(Math.abs(box.y - y)).toBeLessThan(1);

  // Outside Annotate mode a click is an ordinary click.
  await page.mouse.click(...at(100, TEXT_MIDLINE));
  expect(await selectedKind(page)).toBeUndefined();

  await sendAction(page, { action: "setTool", tool: "annotate" });
  await page.mouse.click(...at(100, TEXT_MIDLINE));
  await expect.poll(() => selectedKind(page)).toBe("hl-0badf00d");
  await expect(
    page.locator(
      '.sidecar-highlight.is-selected[data-highlight-id="hl-0badf00d"]',
    ),
  ).toHaveCount(1);
  expect(await lastSelection(page)).toMatchObject({
    kind: "region",
    page: 1,
    text: "Synthetic",
  });

  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await writes(page)).at(-1))
    .toMatchObject({ op: "delete", id: "hl-0badf00d" });
  await expect(line).toHaveCount(0);
  expect(await pdfSaves(page)).toEqual([]);
});

test("a click off the highlight deselects it, and the host's list replaces the viewer's", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, { type: "sidecar", highlights: [SYNTHETIC] });
  await sendAction(page, { action: "setTool", tool: "annotate" });
  const at = await pagePoint(page, 1);
  await page.mouse.click(...at(100, TEXT_MIDLINE));
  await expect(page.locator(".sidecar-highlight.is-selected")).toHaveCount(1);
  // Blank paper (the fixture's link to page 5 is at 300 to 330 points down).
  await page.mouse.click(...at(150, 200));
  await expect(page.locator(".sidecar-highlight.is-selected")).toHaveCount(0);
  // A malformed entry from the file is dropped; the good one stays.
  await send(page, {
    type: "sidecar",
    highlights: [{ ...SYNTHETIC, id: "hl-2", page: 0 }, SYNTHETIC],
  });
  await expect(page.locator(".sidecar-highlight")).toHaveCount(1);
  await send(page, { type: "sidecar", highlights: [] });
  await expect(page.locator(".sidecar-highlight")).toHaveCount(0);
});

test("a sidecar highlight stays out of the PDF when another tool saves it", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, { type: "sidecar", highlights: [] });
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  await highlightAcross(page, 74, 130);
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  // Underline still writes into the PDF (direct-to-PDF, as before), here
  // beside the highlight: a press on a highlight selects it instead.
  await sendAction(page, { action: "setAnnotationTool", tool: "underline" });
  await highlightAcross(page, 150, 205);
  await expect
    .poll(async () => (await pdfSaves(page)).length)
    .toBeGreaterThan(0);
  const saved = (await pdfSaves(page)).at(-1)!;
  expect(saved).toMatch(/\/Underline/);
  expect(saved).not.toMatch(/\/Highlight/);
  const id = (
    (await writes(page))[0] as unknown as { highlight: { id: string } }
  ).highlight.id;
  expect(saved).not.toContain(id);
});

test("a highlight whose text moved is re-attached by its quote; one whose quote is gone is marked stale", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  // As if written for an older version of the PDF: the boxes sit 200 points
  // below "Synthetic", which the quote and its context still find.
  const moved = {
    ...SYNTHETIC,
    id: "hl-moved",
    segmentRects: [{ x: 72, y: 288, w: 62, h: 14 }],
  };
  const gone = {
    ...SYNTHETIC,
    id: "hl-gone",
    quote: "words no longer on the page",
    segmentRects: [{ x: 72, y: 200, w: 62, h: 14 }],
  };
  await send(page, { type: "sidecar", highlights: [SYNTHETIC, moved, gone] });
  await expect
    .poll(async () =>
      (await writes(page)).map(
        (write) =>
          (write as unknown as { highlight?: { id: string } }).highlight?.id,
      ),
    )
    .toEqual(["hl-moved"]);
  const rewritten = (
    (await writes(page))[0] as unknown as {
      highlight: typeof moved;
    }
  ).highlight;
  expect(rewritten.modified).not.toBe(moved.modified);
  const [rect] = rewritten.segmentRects;
  expect(rect!.x).toBeGreaterThanOrEqual(70);
  expect(rect!.y).toBeGreaterThan(80);
  expect(rect!.y + rect!.h).toBeLessThan(110);
  await expect(
    page.locator('.sidecar-highlight.is-stale[data-highlight-id="hl-gone"]'),
  ).toHaveCount(1);
  // The highlight already in place is left alone, and none is checked twice.
  await page.waitForTimeout(500);
  expect(await writes(page)).toHaveLength(1);
  expect(await pdfSaves(page)).toEqual([]);
});

test("a click slightly off a sidecar line still selects it for Delete while the highlight tool is active", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, { type: "sidecar", highlights: [SYNTHETIC] });
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const at = await pagePoint(page, 1);
  // Just outside the 14pt-tall line (y 88..102) — within HIT_SLOP.
  await page.mouse.click(...at(100, 104));
  await expect.poll(() => selectedKind(page)).toBe("hl-0badf00d");
  expect(await lastSelection(page)).toMatchObject({
    kind: "region",
    highlightId: "hl-0badf00d",
    mark: true,
  });
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await writes(page)).at(-1))
    .toMatchObject({ op: "delete", id: "hl-0badf00d" });
  await expect(
    page.locator('.sidecar-highlight[data-highlight-id="hl-0badf00d"]'),
  ).toHaveCount(0);
});
