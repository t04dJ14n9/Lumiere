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

// The text of the test PDF's first page is "Synthetic page 1", from x 72.
const SYNTHETIC = 100;
const PAGE = 155;

const lookUps = async (page: Page) =>
  (await messages(page)).filter((message) => message.type === "lookUp");

async function forceClick(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const event = new MouseEvent("webkitmouseforcedown", {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(event);
    },
    { x, y },
  );
}

test("with Look Up on, a force click on a word asks the host to look it up", async ({
  page,
}) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const at = await pagePoint(page, 1);
  const [x, y] = at(SYNTHETIC, TEXT_MIDLINE);
  await forceClick(page, x, y);
  await expect
    .poll(async () => (await lookUps(page)).at(-1))
    .toEqual({ type: "lookUp", word: "Synthetic", open: true });
  const [x2, y2] = at(PAGE, TEXT_MIDLINE);
  await forceClick(page, x2, y2);
  await expect
    .poll(async () => (await lookUps(page)).at(-1))
    .toEqual({ type: "lookUp", word: "page", open: true });
});

test("the context menu reports the word under the pointer, and nothing when there is none", async ({
  page,
}) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const at = await pagePoint(page, 1);
  const [x, y] = at(SYNTHETIC, TEXT_MIDLINE);
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
  await page.mouse.click(x, y, { button: "right" });
  await expect
    .poll(async () => (await lookUps(page)).at(-1))
    .toEqual({ type: "lookUp", word: "Synthetic", open: false });
  await send(page, { type: "lookUpRequest" });
  await expect
    .poll(async () => (await lookUps(page)).at(-1))
    .toEqual({ type: "lookUp", word: "Synthetic", open: true });
  // On empty page space the menu has no word to offer.
  const [ex, ey] = at(300, 500);
  await page.mouse.move(ex, ey);
  await page.waitForTimeout(400);
  await page.mouse.click(ex, ey, { button: "right" });
  await expect
    .poll(async () => (await lookUps(page)).at(-1))
    .toEqual({ type: "lookUp", word: null, open: false });
});

test("Look Up is off until the host turns it on, and off again when it says so", async ({
  page,
}) => {
  await open(page);
  const at = await pagePoint(page, 1);
  const [x, y] = at(SYNTHETIC, TEXT_MIDLINE);
  await forceClick(page, x, y);
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForTimeout(500);
  expect(await lookUps(page)).toEqual([]);
  await send(page, { type: "lookUp", enabled: true });
  await send(page, { type: "lookUp", enabled: false });
  await forceClick(page, x, y);
  await page.waitForTimeout(500);
  expect(await lookUps(page)).toEqual([]);
});

test("text selection still works with Look Up on", async ({ page }) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const at = await pagePoint(page, 1);
  const [x1, y1] = at(74, TEXT_MIDLINE);
  const [x2, y2] = at(205, TEXT_MIDLINE);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => lastSelection(page)).toMatchObject({ kind: "text" });
});

/**
 * What Chromium's own Look Up (a hard press, or a three-finger tap) reads:
 * the text at the point, as `caretRangeFromPoint` finds it.
 */
const textAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => {
      const range = document.caretRangeFromPoint(x, y);
      const node = range?.startContainer;
      return node?.nodeType === Node.TEXT_NODE
        ? {
            text: node.textContent,
            inWord: Boolean(node.parentElement?.closest(".look-up-word")),
          }
        : undefined;
    },
    { x, y },
  );

test("the word the pointer rests on is real text under it, for a hard press", async ({
  page,
}) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const at = await pagePoint(page, 1);
  const [x, y] = at(SYNTHETIC, TEXT_MIDLINE);
  await page.mouse.move(x, y);
  await expect
    .poll(() => textAt(page, x, y))
    .toEqual({ text: "Synthetic", inWord: true });
  // It covers the word's glyphs: both ends of the word find it too.
  const word = page.locator(".look-up-word");
  const box = (await word.boundingBox())!;
  expect(box.x).toBeLessThan(x);
  expect(box.x + box.width).toBeGreaterThan(x);
  expect(await textAt(page, box.x + 1, y)).toMatchObject({ inWord: true });
  expect(await textAt(page, box.x + box.width - 1, y)).toMatchObject({
    inWord: true,
  });
  await expect(word).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  // Another word moves it; empty paper takes it away.
  const [x2, y2] = at(PAGE, TEXT_MIDLINE);
  await page.mouse.move(x2, y2);
  await expect
    .poll(() => textAt(page, x2, y2))
    .toEqual({ text: "page", inWord: true });
  const [ex, ey] = at(150, 250);
  await page.mouse.move(ex, ey);
  await expect(word).toHaveCount(0);
  // Off, it is gone.
  await page.mouse.move(x, y);
  await expect(word).toHaveCount(1);
  await send(page, { type: "lookUp", enabled: false });
  await expect(word).toHaveCount(0);
});

test("a drag that starts on the hidden word selects the PDF's text, not the word", async ({
  page,
}) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const at = await pagePoint(page, 1);
  const [x1, y1] = at(SYNTHETIC, TEXT_MIDLINE);
  const [x2, y2] = at(205, TEXT_MIDLINE);
  await page.mouse.move(x1, y1);
  await expect(page.locator(".look-up-word")).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => lastSelection(page)).toMatchObject({ kind: "text" });
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");
  // A double click on it does not select the hidden text either.
  await page.mouse.move(x1, y1);
  await page.mouse.dblclick(x1, y1);
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");
});

test("without Look Up there is no hidden word", async ({ page }) => {
  await open(page);
  const at = await pagePoint(page, 1);
  const [x, y] = at(SYNTHETIC, TEXT_MIDLINE);
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
  await expect(page.locator(".look-up-word")).toHaveCount(0);
});

test("with Look Up on, links and Annotate marks keep their clicks", async ({
  page,
}) => {
  await open(page);
  await send(page, { type: "lookUp", enabled: true });
  const link = page.getByRole("link", { name: "Go to page 5" });
  await link.hover();
  await page.waitForTimeout(300);
  await link.click();
  await expect(page.getByRole("textbox", { name: "Page" })).toHaveValue("5");
  await page.getByRole("textbox", { name: "Page" }).fill("1");
  await page.getByRole("textbox", { name: "Page" }).press("Enter");

  await sendAction(page, { action: "setTool", tool: "annotate" });
  await sendAction(page, { action: "setAnnotationTool", tool: "highlight" });
  const at = await pagePoint(page, 1);
  const kind = async () =>
    ((await lastSelection(page)) as { kind?: string } | null)?.kind;
  await page.mouse.move(...at(74, TEXT_MIDLINE));
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(...at(205, TEXT_MIDLINE), { steps: 10 });
  await page.mouse.up();
  await expect.poll(kind).toBe("region");
  await page.keyboard.press("Escape");
  await expect.poll(kind).toBeUndefined();
  await sendAction(page, { action: "setTool", tool: "annotate" });
  const mid = at(140, TEXT_MIDLINE);
  await page.mouse.move(...mid);
  await page.waitForTimeout(300);
  await page.mouse.click(...mid);
  await expect.poll(kind).toBe("region");
});
