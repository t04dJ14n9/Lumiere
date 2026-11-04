import { expect, test, type Page } from "@playwright/test";
import { send } from "./view-controls-support";
import {
  messages,
  open,
  pagePoint,
  sendAction,
  TEXT_MIDLINE,
} from "./viewer-support";

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

async function highlightMarkCount(page: Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        '.page [style*="mix-blend-mode: multiply"], .page [style*="mix-blend-mode:multiply"]',
      ).length,
  );
}

async function highlightAcross(page: Page, from: number, to: number) {
  const at = await pagePoint(page, 1);
  await page.mouse.move(...at(from, TEXT_MIDLINE));
  await page.mouse.down();
  await page.mouse.move(...at(to, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
}

test("highlight tool no longer emits sidecarWrite; it burns into the PDF", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  // Legacy host still may claim a sidecar list; create path must stay absent.
  await send(page, { type: "sidecar", highlights: [] });
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const baseline = await highlightMarkCount(page);
  await highlightAcross(page, 74, 205);
  await expect
    .poll(async () => (await highlightMarkCount(page)) > baseline)
    .toBe(true);
  await expect
    .poll(async () => (await pdfSaves(page)).length)
    .toBeGreaterThan(0);
  const saved = (await pdfSaves(page)).at(-1)!;
  expect(saved).toMatch(/\/Highlight/);
  expect(await writes(page)).toEqual([]);
  await expect(page.locator(".sidecar-highlight")).toHaveCount(0);
});

test("preloaded sidecar highlights are not painted after create-path teardown", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await send(page, {
    type: "sidecar",
    highlights: [
      {
        id: "hl-0badf00d",
        page: 1,
        subtype: "highlight",
        color: "#FFE566",
        opacity: 0.45,
        segmentRects: [{ x: 72, y: 88, w: 76, h: 14 }],
        quote: "Synthetic",
        contextBefore: "",
        contextAfter: " page 1",
        created: "2026-11-01T18:00:00.000Z",
        modified: "2026-11-01T18:00:00.000Z",
      },
    ],
  });
  await page.waitForTimeout(400);
  await expect(page.locator(".sidecar-highlight")).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});
